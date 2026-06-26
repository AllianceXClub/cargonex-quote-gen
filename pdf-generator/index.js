/**
 * CargoNex PDF Generator — Node.js + Playwright
 * Deploy: Cloud Run (europe-west1), project: quota-gen
 */

import express from "express";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { readFileSync } from "fs";
import { resolve } from "path";

// Logo embedded at startup — avoids CDN fetch failures in Cloud Run
let LOGO_BASE64 = "";
try {
  const logoPath = resolve(process.env.LOGO_PATH || "./assets/cargonex-logo.png");
  LOGO_BASE64 = `data:image/png;base64,${readFileSync(logoPath).toString("base64")}`;
  console.log("[STARTUP] Logo loaded OK");
} catch (e) {
  console.warn("[STARTUP] Logo not found — text fallback:", e.message);
}

const app = express();
app.use(express.json({ limit: "10mb" }));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PDF_GENERATOR_SECRET = process.env.PDF_GENERATOR_SECRET;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const OWNER_EMAIL = process.env.OWNER_EMAIL || "";
const FROM_EMAIL = process.env.FROM_EMAIL || "CargoNex <hello@cargonex.io>";
const STORAGE_BUCKET = "signed-quotes";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const resend = new Resend(RESEND_API_KEY);

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !PDF_GENERATOR_SECRET || !RESEND_API_KEY) {
  console.error("[STARTUP] Missing required env vars. Refusing to start.");
  process.exit(1);
}

// ===== AUTH =====

function requireSecret(req, res, next) {
  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${PDF_GENERATOR_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// ===== ROUTES =====

app.post("/generate-pdf", requireSecret, async (req, res) => {
  const {
    signature_id,
    quote_id,
    signer_name,
    signer_email,
    client_name,
    signed_at,
    setup_fee,
    monthly_fee,
    signature_b64,
    owner_email,
    viewer_emails = [],
    quote_html,
    signer_role = "",
    signer_phone = "",
    sender_name = "",
    stamp_image_url = "",
    signature_type = "drawn",
  } = req.body;

  console.log(`[PDF] Starting for ${quote_id} / ${signature_id}`);

  let browser;
  try {
    browser = await chromium.launch({
      args: [
        "--no-sandbox", "--disable-setuid-sandbox",
        "--disable-dev-shm-usage", "--disable-gpu",
        "--disable-extensions", "--run-all-compositor-stages-before-draw",
      ],
    });

    const signedAtFormatted = (() => {
  const d = new Date(signed_at);
  const date = d.toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric", year: "numeric" });
  const time = d.toLocaleTimeString("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" });
  return `${date} בשעה ${time}`;
})();

    // 1. Extract structured content from stored quote HTML
    let extracted = { pains: [], benefits: [], terms: [], issueDate: "", expiryDate: "" };
    if (quote_html) {
      const extractPage = await browser.newPage();
      try {
        await extractPage.route("**/*", (route) => {
          const url = route.request().url();
          if (url.includes("supabase.co/functions") || url.includes("track-event") || url.includes("analytics")) {
            route.abort();
          } else {
            route.continue();
          }
        });
        await extractPage.setContent(quote_html, { waitUntil: "domcontentloaded", timeout: 15000 });
        extracted = await extractQuoteData(extractPage);
      } catch (e) {
        console.warn("[PDF] extractQuoteData failed:", e.message);
      } finally {
        await extractPage.close();
      }
    }

    // 2. Build clean white A4 print HTML
    const printHtml = buildPrintHtml({
      quote_id, signer_name, signer_email, client_name,
      setup_fee, monthly_fee,
      signed_at: signedAtFormatted,
      signature_id, signature_b64,
      signer_role,
      signer_phone,
      sender_name,
      stamp_image_url,
      signature_type,
      owner_email: owner_email || OWNER_EMAIL,
      mode: "signed",
      ...extracted,
    });

    // 3. Render to PDF
    const printPage = await browser.newPage();
    await printPage.setContent(printHtml, { waitUntil: "domcontentloaded", timeout: 20000 });
    await Promise.race([
      printPage.waitForFunction(() => document.fonts.ready, { timeout: 4000 }),
      new Promise(r => setTimeout(r, 2000))
    ]);
    const pdfBuffer = await printPage.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "15mm", bottom: "15mm", left: "15mm", right: "15mm" },
    });
    await printPage.close();
    await browser.close();
    browser = null;

    // 4. Upload to Supabase Storage
    const filename = `${quote_id}-${signature_id}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filename, pdfBuffer, { contentType: "application/pdf", upsert: false });
    if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

    // 5. Get permanent public URL
    const { data: { publicUrl: pdfUrl } } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(filename);

    // 6. Update signature record
    await supabase.from("quote_signatures").update({ pdf_url: pdfUrl }).eq("id", signature_id);

    // 7. Send email
    const effectiveOwnerEmail = owner_email || OWNER_EMAIL;
    const emailHtml = buildEmailHtml({ signer_name, quote_id, pdfUrl, signedAt: signedAtFormatted, ownerEmail: effectiveOwnerEmail });
    const allRecipients = [...new Set([signer_email, effectiveOwnerEmail, ...viewer_emails].filter(Boolean))];
    await resend.emails.send({
      from: FROM_EMAIL,
      to: allRecipients,
      subject: `ההצעה נחתמה — ${quote_id} | CargoNex`,
      html: emailHtml,
    });

    console.log(`[PDF] Done for ${quote_id}. URL: ${pdfUrl}`);
    res.json({ ok: true, pdf_url: pdfUrl });

  } catch (err) {
    console.error(`[PDF] Error for ${quote_id}:`, err.message);
    if (browser) await browser.close().catch(() => { });
    res.status(500).json({ error: err.message });
  }
});

app.post("/preview-pdf", requireSecret, async (req, res) => {
  const { html, stamp_b64 = "", signer_name = "", signer_role = "" } = req.body;
  let browser;
  try {
    browser = await chromium.launch({
      args: [
        "--no-sandbox", "--disable-setuid-sandbox",
        "--disable-dev-shm-usage", "--disable-gpu",
        "--disable-extensions", "--run-all-compositor-stages-before-draw",
      ],
    });

    const extractPage = await browser.newPage();
    await extractPage.route("**/*", (route) => {
      const url = route.request().url();
      if (url.includes("supabase.co/functions") || url.includes("track-event") || url.includes("analytics")) {
        route.abort();
      } else {
        route.continue();
      }
    });
    await extractPage.setContent(html, { waitUntil: "domcontentloaded", timeout: 15000 });

    const data = await extractPage.evaluate(() => {
      function txt(el) { return el ? el.textContent.trim() : ""; }
      const pains = [];
      document.querySelectorAll(".pain-item").forEach(el => {
        const title = txt(el.querySelector(".pain-title"));
        const desc = txt(el.querySelector(".pain-desc"));
        if (title) pains.push({ title, desc });
      });
      const benefits = [];
      document.querySelectorAll(".benefit-card").forEach(el => {
        const title = txt(el.querySelector(".benefit-title"));
        const desc = txt(el.querySelector(".benefit-desc"));
        if (title) benefits.push({ title, desc });
      });
      const terms = [];
      document.querySelectorAll("details.term-item").forEach(el => {
        const summEl = el.querySelector("summary");
        const title = summEl ? txt(summEl).replace("＋", "").replace("−", "").trim() : "";
        const termContent = el.querySelector(".term-content");
        if (termContent) termContent.querySelectorAll(".comment-btn,.comment-box,.comment-trigger-wrap,button").forEach(e => e.remove());
        const content = txt(termContent);
        if (title) terms.push({ title, content });
      });
      const dateEls = document.querySelectorAll(".hero-date-value");
      const priceEls = document.querySelectorAll(".pricing-amount");
      return {
        pains, benefits, terms,
        issueDate: txt(dateEls[0]),
        expiryDate: txt(dateEls[1]),
        quoteId: txt(document.querySelector(".hero-quote-id")),
        clientName: txt(document.querySelector(".hero-company")),
        setupFee: txt(priceEls[0]),
        monthlyFee: txt(priceEls[1]),
      };
    });
    await extractPage.close();

    const printHtml = buildPrintHtml({
      quote_id: data.quoteId || "preview",
      signer_name: signer_name,
      signer_email: "",
      client_name: data.clientName || "",
      setup_fee: data.setupFee || "",
      monthly_fee: data.monthlyFee || "",
      signed_at: "",
      signature_id: "",
      signature_b64: "",
      signer_role: signer_role,
      signer_phone: "",
      sender_name: "",
      stamp_image_url: stamp_b64,
      signature_type: "drawn",
      owner_email: OWNER_EMAIL,
      mode: "preview",
      pains: data.pains,
      benefits: data.benefits,
      terms: data.terms,
      issueDate: data.issueDate,
      expiryDate: data.expiryDate,
    });

    const printPage = await browser.newPage();
    await printPage.setContent(printHtml, { waitUntil: "domcontentloaded", timeout: 20000 });
    await printPage.waitForTimeout(1500);
    const pdf = await printPage.pdf({ format: "A4", printBackground: true, margin: { top: "15mm", bottom: "15mm", left: "15mm", right: "15mm" } });
    await printPage.close();
    await browser.close();
    res.setHeader("Content-Type", "application/pdf");
    res.send(pdf);
  } catch (err) {
    if (browser) await browser.close().catch(() => { });
    res.status(500).json({ error: err.message });
  }
});

app.get("/health", (req, res) => res.json({ ok: true }));

// ===== HTML BUILDERS =====

function buildEmailHtml({ signer_name, quote_id, pdfUrl, signedAt, ownerEmail }) {
  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"/></head>
<body style="font-family:'Segoe UI',Arial,sans-serif;background:#f4f4f4;padding:32px;margin:0;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;">
    <div style="background:#0A0A0A;padding:24px 32px;text-align:right;">
      <span style="color:#E74C3C;font-size:20px;font-weight:700;">CargoNex</span>
    </div>
    <div style="padding:32px;direction:rtl;text-align:right;">
      <h2 style="font-size:20px;margin-bottom:8px;color:#111;">ההצעה נחתמה בהצלחה ✅</h2>
      <p style="color:#555;font-size:15px;margin-bottom:4px;">שלום <bdi>${signer_name}</bdi>,</p>
      <p style="color:#555;font-size:15px;margin-bottom:24px;">ההצעה <strong>${quote_id}</strong> נחתמה ב־${signedAt}.</p>
      <a href="${pdfUrl}" style="display:inline-block;background:#E74C3C;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">
        📄 להורדת ההצעה החתומה
      </a>
      <p style="color:#aaa;font-size:12px;margin-top:24px;">הלינק קבוע ואינו פג תוקף. לכל שאלה — <a href="mailto:${ownerEmail}" style="color:#E74C3C;">${ownerEmail}</a></p>
    </div>
  </div>
</body>
</html>`;
}

async function extractQuoteData(page) {
  return await page.evaluate(() => {
    function txt(el) { return el ? el.textContent.trim() : ""; }

    const pains = [];
    document.querySelectorAll(".pain-item").forEach(el => {
      const title = txt(el.querySelector(".pain-title"));
      const desc = txt(el.querySelector(".pain-desc"));
      if (title) pains.push({ title, desc });
    });

    const benefits = [];
    document.querySelectorAll(".benefit-card").forEach(el => {
      const title = txt(el.querySelector(".benefit-title"));
      const desc = txt(el.querySelector(".benefit-desc"));
      if (title) benefits.push({ title, desc });
    });

    const terms = [];
    document.querySelectorAll("details.term-item").forEach(el => {
      const summEl = el.querySelector("summary");
      const title = summEl ? txt(summEl).replace("＋", "").replace("−", "").trim() : "";
      const termContent = el.querySelector(".term-content");
      if (termContent) {
        termContent.querySelectorAll(".comment-btn, .comment-box, .comment-trigger-wrap, .comment-submit-btn, .comment-sent-msg, button").forEach(e => e.remove());
      }
      const content = txt(termContent);
      if (title) terms.push({ title, content });
    });

    const dateEls = document.querySelectorAll(".hero-date-value");
    return {
      pains, benefits, terms,
      issueDate: txt(dateEls[0]),
      expiryDate: txt(dateEls[1]),
    };
  });
}
function calcTotal(setupFee, monthlyFee) {
  const s = parseFloat(String(setupFee).replace(/[^\d.]/g, '')) || 0;
  const m = parseFloat(String(monthlyFee).replace(/[^\d.]/g, '')) || 0;
  const total = s + (m * 12);
  return total ? '₪' + total.toLocaleString('he-IL') : '—';
}
function buildPrintHtml({
  quote_id, signer_name, signer_email, client_name,
  setup_fee, monthly_fee, signed_at, signature_id, signature_b64, owner_email,
  signer_role = "", signer_phone = "", sender_name = "",
  stamp_image_url = "", signature_type = "drawn",
  mode = "signed",
  pains = [], benefits = [], terms = [], issueDate = "", expiryDate = "",
  countersigned = false,
  countersigner_name = "",
  countersigner_role = "",
  countersign_sig_b64 = "",
  countersigned_at = "",
}) {
  const esc = s => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const isSigned = mode === "signed";

  const painRows = pains.map((p, i) =>
    `<div class="pain-row${i > 0 ? ' pain-row-secondary' : ''}">` +
    `<div class="pain-title">${esc(p.title)}</div>` +
    `<div class="pain-desc">${esc(p.desc)}</div></div>`
  ).join("");

  const benCards = benefits.map(b =>
    `<div class="ben-card">` +
    `<div class="ben-title">${esc(b.title)}</div>` +
    `<div class="ben-desc">${esc(b.desc)}</div></div>`
  ).join("");

  const termRows = terms.map((t, i) =>
    `<div class="term-row${i === 0 ? " highlight" : ""}">` +
    `<div class="term-title">${esc(t.title)}</div>` +
    `<div class="term-text">${esc(t.content)}` +
    `${i === 0 ? ' <span class="vat-note">כל הסכומים לפני מע"מ.</span>' : ""}` +
    `</div></div>`
  ).join("");

  // Blank signing row helper (for preview and CargoNex side)
  const blankLine = (label) =>
    `<div style="margin:10px 0 2px;">
      <div style="border-bottom:2px solid #444;height:28px;"></div>
      <div style="font-size:9px;font-weight:700;color:#333;text-align:center;margin-top:3px;">${label}</div>
    </div>`;

  // Stamp area helper
  const stampArea = (imgUrl) => imgUrl
    ? `<img style="max-width:90px;max-height:55px;display:block;margin:8px auto;border:1px solid #eee;border-radius:4px;" src="${imgUrl}" alt="חותמת"/>`
    : "";

  // Signature image — invert only for drawn (white-on-transparent → black-on-white)
  const sigImgClass = signature_type === "drawn" ? "sig-img sig-img-drawn" : "sig-img sig-img-digital";

  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="UTF-8"/>
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;700&display=swap" rel="stylesheet"/>
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Heebo',Arial,sans-serif;background:#fff;color:#111;direction:rtl;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.watermark{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-35deg);font-size:96px;font-weight:900;color:rgba(180,30,20,0.085);pointer-events:none;z-index:0;white-space:nowrap;letter-spacing:0.1em;}
/* ── Header ── */
.pdf-logo-area{padding:16px 28px 14px;display:flex;align-items:center;justify-content:space-between;background:#fff;position:relative;z-index:1;}
.pdf-logo-img{height:56px;width:auto;}
.pdf-logo-text{font-size:22px;font-weight:700;}
.signed-badge{display:inline-flex;align-items:center;gap:4px;background:#F0FBF4;border:0.5px solid #B2E4C7;border-radius:999px;padding:3px 10px;font-size:10px;font-weight:700;color:#1a7a45;margin-top:6px;}
.pdf-meta-corner{text-align:left;}
.pdf-meta-id{font-size:16px;font-weight:600;color:#555;line-height:1;}
.pdf-meta-label{font-size:10px;color:#aaa;margin-top:2px;}
.pdf-title-banner{background:#C0392B;padding:14px 28px;position:relative;z-index:1;}
.pdf-banner-title{font-size:20px;font-weight:700;color:#fff;line-height:1.2;}
.pdf-banner-sub{font-size:12px;color:rgba(255,255,255,0.8);margin-top:4px;}
/* ── Client metadata ── */
.client-block{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:0.5px solid #e8e8e8;position:relative;z-index:1;}
.meta-item{padding:11px 16px;border-right:0.5px solid #e8e8e8;}
.meta-item:last-child{border-right:none;}
.meta-item label{font-size:10px;color:#999;display:block;margin-bottom:3px;letter-spacing:0.04em;}
.meta-item span{font-size:12px;font-weight:600;color:#111;display:block;}
.meta-item span.expiry{color:#C0392B;}
/* ── Sections ── */
.section{padding:18px 28px;border-bottom:0.5px solid #e8e8e8;page-break-inside:avoid;position:relative;z-index:1;}
.sec-label{font-size:10px;color:#C0392B;letter-spacing:0.08em;margin-bottom:8px;font-weight:700;text-transform:uppercase;}
/* ── Font hierarchy H1 > H2 > H3 ── */
.h1-title{font-size:20px;font-weight:700;color:#111;margin-bottom:18px;padding-bottom:10px;border-bottom:1.5px solid #e0e0e0;}
.h2-title{font-size:15px;font-weight:700;color:#111;margin-bottom:6px;margin-top:16px;}
.h3-subtitle{font-size:11px;font-weight:600;color:#888;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:12px;}
.subsection:first-of-type .h2-title{margin-top:0;}
/* ── Pain / Benefits ── */
.pain-row{border-right:3px solid #C0392B;padding-right:12px;margin-bottom:10px;page-break-inside:avoid;}
.pain-row-secondary{border-right-color:#ddd;}
.pain-title{font-size:13px;font-weight:700;color:#111;margin-bottom:3px;}
.pain-desc{font-size:11px;color:#555;line-height:1.6;}
.ben-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.ben-card{background:#f8f8f8;border-radius:8px;padding:12px 14px;page-break-inside:avoid;border-right:3px solid #e0e0e0;}
.ben-title{font-size:12px;font-weight:700;color:#111;margin-bottom:3px;}
.ben-desc{font-size:11px;color:#555;line-height:1.5;}
/* ── Pricing ── */
.price-table{border:0.5px solid #e8e8e8;border-radius:8px;overflow:hidden;}
.price-header{display:grid;grid-template-columns:2fr 1fr 1fr;background:#f8f8f8;padding:8px 14px;}
.price-header span{font-size:10px;font-weight:700;color:#aaa;}
.price-row{display:grid;grid-template-columns:2fr 1fr 1fr;padding:12px 14px;border-top:0.5px solid #e8e8e8;align-items:center;}
.price-name{font-size:13px;font-weight:700;color:#111;}
.price-sub{font-size:10px;color:#aaa;}
.price-badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:10px;font-weight:700;text-align:center;}
.badge-once{background:#f3f3f3;color:#666;}
.badge-monthly{background:#F0FBF4;color:#1a7a45;border:0.5px solid #B2E4C7;}
.price-amount{font-size:14px;font-weight:700;color:#111;text-align:left;}
.price-vat{font-size:9px;color:#aaa;text-align:left;}
.price-total{display:flex;justify-content:space-between;align-items:center;padding:13px 14px;background:#f8f8f8;border-top:0.5px solid #e8e8e8;}
.total-label{font-size:12px;color:#555;font-weight:600;}
.total-sub{font-size:10px;color:#aaa;}
.total-amount{font-size:22px;font-weight:700;color:#111;text-align:left;}
.total-vat{font-size:10px;color:#aaa;text-align:left;}
/* ── Terms ── */
.term-row{padding:10px 14px;border:0.5px solid #e8e8e8;border-radius:8px;margin-bottom:6px;page-break-inside:avoid;}
.term-title{font-size:12px;font-weight:700;color:#111;margin-bottom:4px;}
.term-text{font-size:11px;color:#666;line-height:1.6;}
.vat-note{color:#C0392B;font-weight:700;}
/* ── Signatures ── */
.sig-section{padding:18px 28px;position:relative;z-index:1;}
.sig-cols{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
.sig-box{border:2px solid #555;border-radius:10px;padding:14px;text-align:center;page-break-inside:avoid;}
.sig-box-signed{border-color:#B2E4C7;background:#F8FEF9;}
.sig-box-label{font-size:10px;color:#333;font-weight:700;margin-bottom:10px;letter-spacing:0.07em;}
.sig-box-signed .sig-box-label{color:#1a7a45;}
.sig-img{max-width:200px;max-height:80px;display:block;margin:0 auto 8px;border-radius:4px;background:#fff;padding:4px;}
.sig-img-drawn{filter:invert(1);background:transparent;}
.sig-img-digital{filter:none;}
.sig-name{font-size:13px;font-weight:700;color:#111;}
.sig-role{font-size:11px;color:#444;margin-top:2px;}
.sig-date{font-size:11px;color:#444;margin-top:2px;}
.sig-phone{font-size:10px;color:#555;margin-top:2px;direction:ltr;display:block;}
.sig-id{font-size:9px;color:#ccc;margin-top:5px;direction:ltr;display:block;}
/* ── Next steps ── */
.next-steps{padding:14px 28px;background:#F0FBF4;border-top:0.5px solid #B2E4C7;page-break-inside:avoid;position:relative;z-index:1;display:flex;align-items:flex-start;gap:10px;}
.next-steps-icon{font-size:15px;color:#1a7a45;flex-shrink:0;margin-top:1px;}
.next-steps-body{font-size:12px;color:#555;line-height:1.7;}
.next-steps-title{font-size:12px;font-weight:700;color:#111;margin-bottom:3px;}
/* ── Footer ── */
.pdf-footer{padding:8px 28px;border-top:0.5px solid #e8e8e8;font-size:9px;color:#bbb;text-align:center;display:flex;justify-content:center;gap:8px;flex-wrap:wrap;direction:rtl;position:relative;z-index:1;}
</style>
</head>
<body>
${isSigned ? `<div class="watermark">${countersigned ? "נחתם ואושר" : "נחתם"}</div>` : ""}
<div class="pdf-logo-area">
  <div>
    ${LOGO_BASE64
      ? `<img class="pdf-logo-img" src="${LOGO_BASE64}" alt="CargoNex"/>`
      : `<div class="pdf-logo-text">Cargo<span style="color:#C0392B;">Nex</span></div>`}
    ${isSigned ? `<div class="signed-badge">✓ ${countersigned ? "נחתם ואושר" : "נחתם"}</div>` : ""}
  </div>
  <div class="pdf-meta-corner">
    <div class="pdf-meta-id">${esc(quote_id)}</div>
    <div class="pdf-meta-label">מספר הצעה</div>
  </div>
</div>
<div class="pdf-title-banner">
  <div class="pdf-banner-title">הצעה מסחרית: פלטפורמת CargoNex</div>
  <div class="pdf-banner-sub">הצעת מחיר עבור ${esc(client_name)} · תאריך: ${esc(issueDate)}</div>
</div>
<div class="client-block">
  <div class="meta-item"><label>לקוח</label><span>${esc(client_name)}</span></div>
  <div class="meta-item"><label>חותם · תפקיד</label><span>${esc(signer_name) || "—"}${signer_role ? ` · ${esc(signer_role)}` : ""}</span></div>
  <div class="meta-item"><label>תאריך הנפקה</label><span>${esc(issueDate)}</span></div>
  <div class="meta-item"><label>תוקף עד</label><span class="expiry">${esc(expiryDate)}</span></div>
</div>
<div class="section">
  <div class="h1-title">רקע ותובנות</div>
  <div class="subsection">
    <div class="h2-title">האתגר שלכם</div>
    <div class="h3-subtitle">מה זיהינו אצלכם</div>
    ${pains.length ? painRows : `<p style="color:#aaa;font-size:12px;font-style:italic;">לא הוגדרו נקודות כאב.</p>`}
  </div>
  <div class="subsection" style="margin-top:18px;">
    <div class="h2-title">הפתרון שלנו</div>
    <div class="h3-subtitle">מה אנחנו בונים לכם</div>
    ${benefits.length ? `<div class="ben-grid">${benCards}</div>` : `<p style="color:#aaa;font-size:12px;font-style:italic;">לא הוגדרו תועלות.</p>`}
  </div>
</div>
<div class="section">
  <div class="h1-title">תמחור</div>
  <div class="price-table">
    <div class="price-header"><span>שירות</span><span style="text-align:center;">סוג</span><span style="text-align:left;">מחיר</span></div>
    <div class="price-row">
      <div><div class="price-name">הטמעה מקוסטמת</div><div class="price-sub">הקמה מותאמת לתהליכים עסקיים</div></div>
      <div style="text-align:center;"><span class="price-badge badge-once">חד פעמי</span></div>
      <div><div class="price-amount">${esc(setup_fee)}</div><div class="price-vat">+ מע"מ</div></div>
    </div>
    <div class="price-row">
      <div><div class="price-name">תשתית + רישוי SaaS</div><div class="price-sub">שירות שוטף, SLA כלול</div></div>
      <div style="text-align:center;"><span class="price-badge badge-monthly">חודשי</span></div>
      <div><div class="price-amount">${esc(monthly_fee)}</div><div class="price-vat">לחודש + מע"מ</div></div>
    </div>
    <div class="price-total">
      <div><div class="total-label">סה"כ התחייבות שנתית</div><div class="total-sub">הטמעה + 12 חודשי רישוי</div></div>
      <div><div class="total-amount">${calcTotal(setup_fee, monthly_fee)}</div><div class="total-vat">לפני מע"מ</div></div>
    </div>
  </div>
</div>
${terms.length ? `<div class="section"><div class="h1-title">תנאי ההתקשרות</div>${termRows}</div>` : ""}
<div class="sig-section">
  <div class="h1-title">אישור הצדדים</div>
  ${isSigned ? `<div class="h1-title" style="margin-bottom:14px;">${countersigned ? "✓ ההסכם אושר — שני הצדדים חתמו" : "✓ ממתין לאישור CargoNex"}</div>` : ""}
  <div class="sig-cols">
    <!-- Client side -->
    <div class="sig-box${isSigned ? " sig-box-signed" : ""}">
      <div class="sig-box-label">${isSigned ? "✓ " : ""}הלקוח</div>
      ${isSigned && signature_b64
        ? `<img class="sig-img ${sigImgClass}" src="${signature_b64}" alt="חתימה"/>`
        : ""}
      ${stampArea(isSigned ? stamp_image_url : stamp_image_url)}
      ${isSigned
        ? `<div class="sig-name">${esc(signer_name)}</div>
           ${signer_role ? `<div class="sig-role">${esc(signer_role)}</div>` : ""}
           <div class="sig-date">${esc(signed_at)}</div>
           ${signer_phone ? `<span class="sig-phone">${esc(signer_phone)}</span>` : ""}
           <span class="sig-id">${esc(signature_id)}</span>`
        : `${signer_name ? `<div class="sig-name">${esc(signer_name)}</div>` : blankLine("שם מלא")}
           ${signer_role ? `<div class="sig-role">${esc(signer_role)}</div>` : blankLine("תפקיד")}
           ${blankLine("חתימה")}${blankLine("תאריך")}`}
    </div>
    <!-- CargoNex side -->
    <div class="sig-box${countersigned ? " sig-box-signed" : ""}">
      <div class="sig-box-label">${countersigned ? "✓ " : ""}CargoNex</div>
      ${countersigned && countersign_sig_b64
        ? `<img class="sig-img sig-img-drawn" src="${countersign_sig_b64}" alt="חתימת CargoNex"/>`
        : ""}
      ${stampArea("")}
      ${countersigned
        ? `<div class="sig-name">${esc(countersigner_name)}</div>
           ${countersigner_role ? `<div class="sig-role">${esc(countersigner_role)}</div>` : ""}
           <div class="sig-date">${esc(countersigned_at)}</div>`
        : `${blankLine("שם מלא")}${blankLine("תפקיד")}${blankLine("חתימה")}${blankLine("תאריך")}`}
    </div>
  </div>
</div>
<div class="next-steps">
  <div class="next-steps-icon">✅</div>
  <div>
    <div class="next-steps-title">מה קורה עכשיו?</div>
    <div class="next-steps-body">
      ${countersigned ? "ההסכם אושר ונחתם על ידי שני הצדדים. העתק מלא נשלח לכל הצדדים." : "נציג מטעמנו יפנה אליכם תוך יום עסקים."}<br/>
      לכל שאלה: <span style="direction:ltr;display:inline-block;">${esc(owner_email)}</span>
    </div>
  </div>
</div>
<div class="pdf-footer">
  <span>מסמך זה נחתם אלקטרונית בהתאם לחוק חתימה אלקטרונית, התשס"א-2001</span>
  <span style="direction:ltr;display:inline-block;">| CargoNex · ${esc(owner_email)} |</span>
  <span style="direction:ltr;display:inline-block;">מזהה חתימה: ${esc(signature_id) || "preview"}</span>
</div>
</body>
</html>`;
}

// ===== COUNTERSIGN EMAIL =====

function buildCountersignEmailHtml({ signer_name, quote_id, csUrl, countersignedAt, ownerEmail }) {
  return `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#fff;color:#111;">
    <div style="background:#C0392B;height:4px;border-radius:2px;margin-bottom:32px;"></div>
    <h2 style="font-size:24px;font-weight:700;margin:0 0 8px;">✅ ההסכם אושר — שני הצדדים חתמו</h2>
    <p style="color:#555;margin:0 0 24px;">מספר הצעה: <strong>${quote_id}</strong></p>
    <p style="margin:0 0 16px;">שלום <strong>${signer_name}</strong>,</p>
    <p style="color:#555;margin:0 0 24px;">ההסכם אושר ונחתם על ידי שני הצדדים.<br/>מצורף העתק מלא עם שתי החתימות.</p>
    <div style="margin:24px 0;">
      <a href="${csUrl}" style="background:#C0392B;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;">📄 הורד הסכם מלא</a>
    </div>
    <p style="color:#aaa;font-size:13px;">תאריך אישור: ${countersignedAt}</p>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0;"/>
    <p style="color:#aaa;font-size:12px;">CargoNex · ${ownerEmail}</p>
  </div>`;
}

// ===== /countersign-pdf ROUTE =====

app.post("/countersign-pdf", requireSecret, async (req, res) => {
  const {
    signature_id,
    countersigner_name = "דרור",
    countersigner_role = 'מנכ"ל CargoNex',
    countersign_sig_b64,
  } = req.body;

  if (!signature_id || !countersign_sig_b64) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  console.log(`[CS-PDF] Starting for signature ${signature_id}`);
  let browser;
  try {
    // 1. Fetch original signature record
    const { data: sigRow, error: sigErr } = await supabase
      .from("quote_signatures")
      .select("*")
      .eq("id", signature_id)
      .single();

    if (sigErr || !sigRow) {
      return res.status(404).json({ error: "Signature not found" });
    }
    if (sigRow.countersigned_at) {
      return res.status(409).json({ error: "Already countersigned" });
    }

    const {
      quote_id, signer_name, signer_email, client_name,
      signature_image, stamp_image_url, setup_fee, monthly_fee,
      signer_role, signer_phone, signed_at, signature_type,
      owner_email: storedOwnerEmail,
    } = sigRow;

    // 2. Fetch quote HTML for content extraction
    const { data: quoteRow } = await supabase
      .from("quotes")
      .select("html_content")
      .eq("quote_id", quote_id)
      .single();

    const countersignedAt = new Date().toISOString();
    const fmt = (iso) => {
      const d = new Date(iso);
      const date = d.toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric", year: "numeric" });
      const time = d.toLocaleTimeString("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" });
      return `${date} בשעה ${time}`;
    };

    browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--disable-extensions", "--run-all-compositor-stages-before-draw"],
    });

    // 3. Extract pains/benefits/terms from stored quote HTML
    let extracted = { pains: [], benefits: [], terms: [], issueDate: "", expiryDate: "" };
    if (quoteRow?.html_content) {
      const extractPage = await browser.newPage();
      try {
        await extractPage.route("**/*", (route) => {
          const url = route.request().url();
          if (url.includes("supabase.co/functions") || url.includes("track-event") || url.includes("analytics")) {
            route.abort();
          } else {
            route.continue();
          }
        });
        await extractPage.setContent(quoteRow.html_content, { waitUntil: "domcontentloaded", timeout: 15000 });
        extracted = await extractQuoteData(extractPage);
      } catch (e) {
        console.warn("[CS-PDF] extractQuoteData failed:", e.message);
      } finally {
        await extractPage.close();
      }
    }

    // 4. Build PDF with both signatures
    const printHtml = buildPrintHtml({
      quote_id, signer_name, signer_email, client_name,
      setup_fee, monthly_fee,
      signed_at: fmt(signed_at),
      signature_id,
      signature_b64: signature_image,
      signer_role: signer_role || "",
      signer_phone: signer_phone || "",
      stamp_image_url: stamp_image_url || "",
      signature_type: signature_type || "drawn",
      owner_email: storedOwnerEmail || OWNER_EMAIL,
      mode: "signed",
      countersigned: true,
      countersigner_name,
      countersigner_role,
      countersign_sig_b64,
      countersigned_at: fmt(countersignedAt),
      ...extracted,
    });

    // 5. Render PDF
    const printPage = await browser.newPage();
    await printPage.setContent(printHtml, { waitUntil: "domcontentloaded", timeout: 20000 });
    await Promise.race([
      printPage.waitForFunction(() => document.fonts.ready, { timeout: 4000 }),
      new Promise(r => setTimeout(r, 2000)),
    ]);
    const pdfBuffer = await printPage.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "15mm", bottom: "15mm", left: "15mm", right: "15mm" },
    });
    await printPage.close();
    await browser.close();
    browser = null;

    // 6. Upload to Supabase Storage
    const csFilename = `${quote_id}-${signature_id}-cs.pdf`;
    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(csFilename, pdfBuffer, { contentType: "application/pdf", upsert: true });
    if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

    const { data: { publicUrl: csUrl } } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(csFilename);

    // 7. Update quote_signatures
    await supabase.from("quote_signatures").update({
      countersigned_at: countersignedAt,
      countersigner_name,
      countersigner_role,
      countersign_sig_b64,
      countersign_pdf_url: csUrl,
    }).eq("id", signature_id);

    // 8. Send email to both parties
    const effectiveOwnerEmail = storedOwnerEmail || OWNER_EMAIL;
    const csEmailHtml = buildCountersignEmailHtml({
      signer_name, quote_id, csUrl,
      countersignedAt: fmt(countersignedAt),
      ownerEmail: effectiveOwnerEmail,
    });
    await resend.emails.send({
      from: FROM_EMAIL,
      to: [...new Set([signer_email, effectiveOwnerEmail].filter(Boolean))],
      subject: `✅ הסכם מלא — שני הצדדים חתמו | ${quote_id}`,
      html: csEmailHtml,
    });

    console.log(`[CS-PDF] Done for ${quote_id}. CS URL: ${csUrl}`);
    res.json({ ok: true, countersign_pdf_url: csUrl });

  } catch (err) {
    console.error(`[CS-PDF] Error:`, err.message);
    if (browser) await browser.close().catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

// ===== SERVER =====

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`CargoNex PDF Generator running on port ${PORT}`));
