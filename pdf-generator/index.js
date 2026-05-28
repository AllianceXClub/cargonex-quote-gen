/**
 * CargoNex PDF Generator — Node.js + Playwright
 *
 * Receives webhook from sign-quote Edge Function.
 * Generates signed quote PDF, uploads to Supabase Storage,
 * sends email via Resend with a LINK (not attachment) — per PRD v1.2.
 *
 * Run: node index.js
 * Deploy: any Node.js host (Railway, Render, small VPS)
 */

import express from "express";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import ws from "ws";

const app = express();
app.use(express.json({ limit: "10mb" }));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PDF_GENERATOR_SECRET = process.env.PDF_GENERATOR_SECRET;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const OWNER_EMAIL = process.env.OWNER_EMAIL || "dror@alliancex.cloud";
const FROM_EMAIL = process.env.FROM_EMAIL || "CargoNex <hello@cargonex.io>";
const STORAGE_BUCKET = "signed-quotes";
const SIGNED_URL_EXPIRY_SECS = 7 * 24 * 60 * 60; // 7 days

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  realtime: { transport: ws },
});
const resend = new Resend(RESEND_API_KEY);

// Auth middleware
function requireSecret(req, res, next) {
  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${PDF_GENERATOR_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

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
  } = req.body;

  console.log(`[PDF] Starting generation for ${quote_id} / ${signature_id}`);

  let browser;
  try {
    // 1. Generate PDF with Playwright
    browser = await chromium.launch({
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",   // קריטי ל-Cloud Run — מונע crash של Chromium
        "--disable-gpu",
        "--single-process",
      ]
    });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1200, height: 1200 });

    const signedAtFormatted = new Date(signed_at).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" });

    const html = buildSignedPdfHtml({
      quote_id, signer_name, signer_email, client_name,
      setup_fee, monthly_fee, signed_at: signedAtFormatted, signature_id, signature_b64,
      owner_email: owner_email || OWNER_EMAIL
    });

    await page.setContent(html, { waitUntil: "networkidle" });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
    });

    await browser.close();
    browser = null;

    // 2. Upload to Supabase Storage
    const filename = `${quote_id}-${signature_id}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filename, pdfBuffer, { contentType: "application/pdf", upsert: false });

    if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

    // 3. Get time-limited signed URL (7 days)
    const { data: urlData, error: urlError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(filename, SIGNED_URL_EXPIRY_SECS);

    if (urlError) throw new Error(`Signed URL failed: ${urlError.message}`);
    const pdfUrl = urlData.signedUrl;

    // 4. Update signature record with PDF URL
    await supabase.from("quote_signatures").update({ pdf_url: pdfUrl }).eq("id", signature_id);

    // 5. Send email via Resend — link only, no attachment
    const effectiveOwnerEmail = owner_email || OWNER_EMAIL;
    const emailHtml = buildEmailHtml({ signer_name, quote_id, pdfUrl, signedAt: signedAtFormatted, ownerEmail: effectiveOwnerEmail });

    // Build recipient list: signer + owner + viewers (deduplicated)
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
    if (browser) await browser.close().catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get("/health", (req, res) => res.json({ ok: true }));

// ===== HTML BUILDERS =====

function buildSignedPdfHtml({ quote_id, signer_name, signer_email, client_name, setup_fee, monthly_fee, signed_at, signature_id, signature_b64, owner_email }) {
  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8"/>
  <link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;700&display=swap" rel="stylesheet"/>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Heebo', Arial, sans-serif; background: #fff; color: #111; direction: rtl; padding: 32px; }
    .header { border-bottom: 3px solid #E74C3C; padding-bottom: 16px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; }
    .logo { font-size: 22px; font-weight: 700; color: #E74C3C; }
    .quote-id { font-size: 13px; color: #888; }
    h1 { font-size: 20px; font-weight: 700; margin-bottom: 20px; }
    .row { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 14px; }
    .label { color: #666; }
    .value { font-weight: 600; }
    .sig-box { border: 1px solid #ddd; border-radius: 8px; padding: 16px; margin: 20px 0; }
    .sig-box h2 { font-size: 14px; color: #888; margin-bottom: 12px; }
    .sig-img { max-width: 300px; border: 1px solid #eee; border-radius: 4px; filter: invert(1); background: #111; padding: 8px; }
    .footer { border-top: 1px solid #eee; margin-top: 24px; padding-top: 16px; font-size: 11px; color: #aaa; }
    .badge { display: inline-block; background: #E74C3C; color: #fff; font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 999px; margin-bottom: 16px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">CargoNex</div>
    <div class="quote-id">${quote_id}</div>
  </div>

  <span class="badge">✅ נחתם</span>
  <h1>עותק חתום — הצעת מחיר ${quote_id}</h1>

  <div class="row"><span class="label">לקוח</span><span class="value">${client_name || '—'}</span></div>
  <div class="row"><span class="label">חותם</span><span class="value">${signer_name}</span></div>
  <div class="row"><span class="label">אימייל</span><span class="value">${signer_email}</span></div>
  <div class="row"><span class="label">נחתם בתאריך</span><span class="value">${signed_at}</span></div>
  ${setup_fee ? `<div class="row"><span class="label">הטמעה</span><span class="value">${setup_fee}</span></div>` : ''}
  ${monthly_fee ? `<div class="row"><span class="label">רישוי חודשי</span><span class="value">${monthly_fee}</span></div>` : ''}

  <div class="sig-box">
    <h2>חתימה אלקטרונית</h2>
    ${signature_b64 ? `<img class="sig-img" src="${signature_b64}" alt="חתימה"/>` : '<em>חתימה לא זמינה</em>'}
  </div>

  <div class="footer">
    מזהה חתימה: ${signature_id} | מסמך זה נחתם אלקטרונית בהתאם לחוק חתימה אלקטרונית, התשס"א-2001. | CargoNex · ${owner_email}
  </div>
</body>
</html>`;
}

function buildEmailHtml({ signer_name, quote_id, pdfUrl, signedAt, ownerEmail }) {
  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,sans-serif;background:#f4f4f4;padding:32px;margin:0;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
    <div style="background:#0A0A0A;padding:24px 32px;text-align:right;">
      <span style="color:#E74C3C;font-size:20px;font-weight:700;">CargoNex</span>
    </div>
    <div style="padding:32px;direction:rtl;text-align:right;">
      <h2 style="font-size:20px;margin-bottom:8px;color:#111;">ההצעה נחתמה בהצלחה ✅</h2>
      <p style="color:#555;font-size:15px;margin-bottom:4px;">שלום ${signer_name},</p>
      <p style="color:#555;font-size:15px;margin-bottom:24px;">ההצעה <strong>${quote_id}</strong> נחתמה ב־${signedAt}.</p>
      <a href="${pdfUrl}"
         style="display:inline-block;background:#E74C3C;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">
        📄 להורדת ההצעה החתומה
      </a>
      <p style="color:#aaa;font-size:12px;margin-top:24px;">הלינק תקף ל-7 ימים. לכל שאלה — <a href="mailto:${ownerEmail}" style="color:#E74C3C;">${ownerEmail}</a></p>
    </div>
  </div>
</body>
</html>`;
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`CargoNex PDF Generator running on port ${PORT}`));
