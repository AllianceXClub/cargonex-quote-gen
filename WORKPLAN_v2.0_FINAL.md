# תכנית עבודה — CargoNex Quote-Gen Phase 2 (סופית)

**גרסה:** 2.0
**תאריך:** 2026-05-29
**מבוסס על:** סיכום שיחה 2026-05-29 + סריקת קוד + החלטות דרור
**Status:** מוכן לביצוע

---

## החלטות שננעלו

| נושא | החלטה | סיבה |
|---|---|---|
| ארכיטקטורת deploy | **Supabase Storage** (אופציה B) | אפס latency, אפס tokens חדשים |
| PDF_GENERATOR_SECRET | **proxy דרך Edge Function** | לא חשוף בclient |
| Volume צפוי | ~10 הצעות/חודש | לא דורש pre-warm |
| Hashed tokens | **דחוי לPhase 3** | UUID v4 = 128-bit entropy. ניחוש מעשי בלתי אפשרי. ROI עכשיו = נמוך |

---

## ארכיטקטורה סופית

```
Admin:
  generator.html → לוחץ "אשר והורד"
    → upload-quote Edge Function
        ├── שמירה ב-quotes-html bucket (Supabase Storage)
        ├── שמירת metadata + html_content בטבלת quotes
        └── trigger send-quote-links → מיילים מיידיים ללקוח + viewers

Customer:
  פותח quotes.cargonex.io/quote-XX.html?t=TOKEN
    → Cloudflare Worker
        → fetch from Supabase Storage (server-side, עם service_key)
        → return HTML
    → לקוח חותם
        → sign-quote Edge Function (DB insert + שליפת html_content)
            → pdf-proxy Edge Function (sigs + html → pdf-generator)
                → Cloud Run + Playwright (HTML מלא + overlay חתימה)
                → upload ל-signed-quotes bucket
                → signed URL (7 ימים)
                → Resend: מייל ללקוח + owner + viewers
```

---

## Pre-Work — תשתית חדשה (לפני כל המשימות)

### A. יצירת bucket בSupabase
- **שם:** `quotes-html`
- **Private** (לא public)
- **MIME:** `text/html`

### B. טבלה חדשה `quotes`
```sql
CREATE TABLE quotes (
  quote_id        VARCHAR(64) PRIMARY KEY,
  filename        VARCHAR(128) NOT NULL,
  html_content    TEXT NOT NULL,        -- עבור PDF render בעתיד
  client_name     VARCHAR(256),
  signer_email    VARCHAR(256),
  setup_fee       NUMERIC,
  monthly_fee     NUMERIC,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- index לחיפוש מהיר
CREATE INDEX idx_quotes_created ON quotes(created_at DESC);
```

### C. הוספת UNIQUE constraint לחתימות (idempotency)
```sql
ALTER TABLE quote_signatures
  ADD CONSTRAINT unique_signer_per_quote
  UNIQUE (quote_id, signer_email);
```
מונע חתימה כפולה במקרה של double-click.

### D. עדכון `quotes/worker.js`
```javascript
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // root → generator
    if (url.pathname === '/' || url.pathname === '') {
      return Response.redirect(url.origin + '/generator.html', 302);
    }

    // generator.html + static assets
    if (url.pathname === '/generator.html' || url.pathname === '/quote-template-v1.html') {
      try { return await env.ASSETS.fetch(request); }
      catch (e) { return new Response('Not found', { status: 404 }); }
    }

    // quote files → Supabase Storage
    const filename = url.pathname.slice(1);
    if (filename.startsWith('quote-') && filename.endsWith('.html')) {
      const storageUrl = `${env.SUPABASE_URL}/storage/v1/object/quotes-html/${filename}`;
      const r = await fetch(storageUrl, {
        headers: { 'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}` }
      });
      if (!r.ok) return new Response('Not found', { status: 404 });
      const html = await r.text();
      return new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache'  // תמיד טרי
        }
      });
    }

    return new Response('Not found', { status: 404 });
  }
}
```

### E. הוספת secrets לCloudflare Worker
```bash
cd quotes
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_KEY
```

**זמן Pre-Work:** ~45 דקות

---

## Task 2A — PDF מלא ⭐ ראשון

**מטרה:** לקוח מקבל PDF של ההצעה השלמה, לא מסמך מצומצם.

### 1. `supabase/functions/sign-quote/index.ts` — עדכון
```typescript
// אחרי שמירת ה-signature ב-DB, שליפת ה-HTML המלא:
const { data: quoteRow } = await supabase
  .from("quotes")
  .select("html_content")
  .eq("quote_id", quote_id)
  .single();

const quote_html = quoteRow?.html_content || null;

// העברה לpdf-generator
fetch(PDF_GENERATOR_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${PDF_GENERATOR_SECRET}`,
  },
  body: JSON.stringify({
    ...existingFields,
    quote_html,  // ← חדש
    signature_b64,
    signed_at: signedAt,
  }),
}).catch(...);
```

### 2. `pdf-generator/index.js` — שכתוב `/generate-pdf`
```javascript
app.post("/generate-pdf", requireSecret, async (req, res) => {
  const { quote_html, signer_name, signed_at, signature_b64,
          quote_id, signature_id, ...rest } = req.body;

  let browser;
  try {
    browser = await chromium.launch({...existingArgs});
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1200, height: 1600 });

    const signedAtFormatted = new Date(signed_at).toLocaleString(
      "he-IL", { timeZone: "Asia/Jerusalem" }
    );

    let pdfBuffer;

    if (quote_html) {
      // PATH A — HTML מלא מGenerator
      await page.setContent(quote_html, { waitUntil: "networkidle" });

      // הזרקת חתימה + ניקוי UI
      await page.evaluate(({ signer_name, signed_at, sig_b64, signature_id }) => {
        const sigSec = document.querySelector('#sec-signature');
        if (sigSec) {
          sigSec.innerHTML = `
            <div style="padding:48px 32px; text-align:center;">
              <h2 style="font-size:24px; font-weight:700; margin-bottom:8px;">
                ✅ ההצעה נחתמה
              </h2>
              <p style="color:rgba(255,255,255,0.6); font-size:14px; margin-bottom:24px;">
                חתימה אלקטרונית — חוק חתימה אלקטרונית, התשס"א-2001
              </p>
              <div style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:12px; padding:24px; display:inline-block;">
                <img src="${sig_b64}" style="max-width:280px; max-height:140px; display:block; margin:0 auto;"/>
                <p style="margin-top:16px; font-weight:600; font-size:16px;">${signer_name}</p>
                <p style="color:rgba(255,255,255,0.5); font-size:13px;">${signed_at}</p>
                <p style="color:rgba(255,255,255,0.3); font-size:11px; margin-top:8px;">
                  מזהה חתימה: ${signature_id}
                </p>
              </div>
            </div>`;
        }
        // הסרת אלמנטים שלא צריכים בPDF
        document.querySelectorAll('#stickyBtn, .canvas-clear, .agree-label')
          .forEach(e => e.remove());
      }, { signer_name, signed_at: signedAtFormatted, sig_b64: signature_b64, signature_id });

      pdfBuffer = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "0", bottom: "0", left: "0", right: "0" }
      });
    } else {
      // PATH B — fallback: HTML מינימלי (הקוד הקיים)
      const html = buildSignedPdfHtml({...rest, signer_name, signed_at: signedAtFormatted, signature_b64, signature_id, quote_id});
      await page.setContent(html, { waitUntil: "networkidle" });
      pdfBuffer = await page.pdf({
        format: "A4", printBackground: true,
        margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" }
      });
    }

    await browser.close();
    browser = null;

    // upload + email (קוד קיים — ללא שינוי)
    // ...
  } catch (err) {...}
});
```

**זמן Task 2A:** ~90 דקות

---

## Task 3 — כפתור PDF preview ב-generator

**מטרה:** Admin יכול להוריד PDF מתצוגה מקדימה, לפני אישור סופי.

**שינוי מהתכנית המקורית:** משתמש בPlaywright (אותו service), לא ב-`window.print()`. תוצאה אמינה ב-RTL.

### 1. `supabase/functions/pdf-proxy/index.ts` — חדש
**מטרה:** הסתרת PDF_GENERATOR_SECRET מהclient.
```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const PDF_GENERATOR_URL = Deno.env.get("PDF_GENERATOR_URL")!;
const PDF_GENERATOR_SECRET = Deno.env.get("PDF_GENERATOR_SECRET")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { html, quote_id } = await req.json();
    if (!html) return new Response(JSON.stringify({ error: "Missing html" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // קריאה לpdf-generator עם secret server-side
    const r = await fetch(`${PDF_GENERATOR_URL.replace('/generate-pdf', '')}/preview-pdf`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${PDF_GENERATOR_SECRET}`,
      },
      body: JSON.stringify({ html, quote_id }),
    });

    if (!r.ok) {
      return new Response(JSON.stringify({ error: "PDF generation failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const pdfBuffer = await r.arrayBuffer();
    return new Response(pdfBuffer, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${quote_id}-preview.pdf"`,
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
```

### 2. `pdf-generator/index.js` — endpoint חדש
```javascript
app.post("/preview-pdf", requireSecret, async (req, res) => {
  const { html, quote_id } = req.body;
  let browser;
  try {
    browser = await chromium.launch({ args: existingArgs });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });

    // הסרת אלמנטים אינטראקטיביים
    await page.evaluate(() => {
      document.querySelectorAll('#stickyBtn, .canvas-clear, button[onclick]')
        .forEach(e => e.style.display = 'none');
    });

    const pdf = await page.pdf({ format: "A4", printBackground: true });
    await browser.close();
    res.setHeader("Content-Type", "application/pdf");
    res.send(pdf);
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    res.status(500).json({ error: err.message });
  }
});
```

### 3. `generator.html` — כפתור ב-Preview Modal
```javascript
// בפונקציה שבונה את previewTopBar — להוסיף כפתור:
'<button class="preview-action-btn" onclick="downloadPreviewPDF()">📄 הורד PDF</button>'

// משתנה global שכבר אמור להיות _previewHtml + _previewQuoteId
async function downloadPreviewPDF() {
    const btn = event.target;
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ מייצר PDF...';
    try {
        const res = await fetch(
          'https://tjitewgiszukqyjujxrh.supabase.co/functions/v1/pdf-proxy',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
            },
            body: JSON.stringify({
              html: _previewHtml,
              quote_id: _previewQuoteId
            })
          }
        );
        if (!res.ok) throw new Error('שגיאה בייצור PDF');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = _previewQuoteId + '-preview.pdf';
        a.click();
        URL.revokeObjectURL(url);
    } catch (e) {
        alert('שגיאה: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}
```

**זמן Task 3:** ~60 דקות

---

## Task 1 — Auto-deploy (Storage-First)

**מטרה:** לוחצים "אשר והורד" → ההצעה באוויר תוך שניות.

### 1. `supabase/functions/upload-quote/index.ts` — חדש
```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SEND_QUOTE_LINKS_URL = Deno.env.get("SEND_QUOTE_LINKS_URL")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const {
      quote_id,
      filename,
      html_content,
      client_name,
      setup_fee,
      monthly_fee,
      signer,
      viewers = [],
      base_url
    } = body;

    if (!quote_id || !filename || !html_content || !signer?.email) {
      return new Response(JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // 1. Upload to Storage (upsert — מאפשר עדכון הצעה קיימת)
    const { error: storageError } = await supabase.storage
      .from("quotes-html")
      .upload(filename, html_content, {
        contentType: "text/html; charset=utf-8",
        upsert: true,
      });

    if (storageError) throw new Error(`Storage: ${storageError.message}`);

    // 2. Upsert metadata + HTML to quotes table (עבור PDF render)
    const { error: dbError } = await supabase.from("quotes").upsert({
      quote_id,
      filename,
      html_content,
      client_name: client_name || null,
      signer_email: signer.email,
      setup_fee: setup_fee || null,
      monthly_fee: monthly_fee || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'quote_id' });

    if (dbError) throw new Error(`DB: ${dbError.message}`);

    // 3. Trigger send-quote-links (לא לחכות — async)
    fetch(SEND_QUOTE_LINKS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quote_id, quote_filename: filename, base_url, signer, viewers }),
    }).catch(e => console.error("send-quote-links failed:", e));

    return new Response(JSON.stringify({ ok: true, url: `${base_url}/${filename}` }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("upload-quote error:", err);
    return new Response(JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
```

### 2. `generator.html` — עדכון confirm flow
מחליפים את קריאת `sendQuoteLinks()` הישירה ב:
```javascript
async function confirmAndUpload() {
    const pd = _pendingPreview;  // השם האמיתי במשתנה הקיים
    showUploadSpinner('מעלה הצעה...');

    try {
        const r = await fetch(
          'https://tjitewgiszukqyjujxrh.supabase.co/functions/v1/upload-quote',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
            },
            body: JSON.stringify({
              quote_id: pd.quoteId,
              filename: pd.filename,
              html_content: pd.html,
              client_name: pd.clientName,
              setup_fee: pd.setupFee,
              monthly_fee: pd.monthlyFee,
              signer: { name: pd.signerName, email: pd.signerEmail },
              viewers: pd.viewers,
              base_url: pd.baseUrl
            })
          }
        );
        if (!r.ok) throw new Error('שגיאה בהעלאה');
        const data = await r.json();
        hideUploadSpinner();
        showSuccessMessage('✅ ההצעה הועלתה ונשלחה ללקוח: ' + data.url);
    } catch (e) {
        hideUploadSpinner();
        // fallback — הורדה ידנית
        downloadHtmlFile(pd.html, pd.filename);
        showFallbackMessage('⚠️ העלאה אוטומטית נכשלה. הקובץ ירד למחשב — העלה ידנית.');
    }
}
```

**הערה ביצוע:** לוודא שהשם של ה-state object בקוד הקיים הוא `_pendingPreview` או דומה. סריקה מהירה לפני העריכה.

**זמן Task 1:** ~75 דקות

---

## Task 2B — חתימה דואלית (drawn vs digital)

**מטרה:** לקוח בוחר — לצייר חתימה ולהעלות חותמת בנפרד, או להעלות תמונה משולבת.

### 1. Migration
```sql
ALTER TABLE quote_signatures
  ADD COLUMN signature_type VARCHAR(32) DEFAULT 'drawn',
  ADD COLUMN stamp_image_url TEXT;
```
**הערה:** חותמת נשמרת כURL לStorage (לא base64) — חוסך 200-500KB/חתימה.

### 2. Storage bucket חדש: `signature-stamps` (private)

### 3. `quote-template-v1.html` — UI חדש
```html
<!-- Toggle בין שתי אפשרויות -->
<div class="sig-type-toggle" style="display:flex;gap:8px;margin-bottom:24px;">
  <button class="sig-type-btn active" onclick="setSigType('drawn')" id="btn-drawn">
    ✏️ חתימה + חותמת
  </button>
  <button class="sig-type-btn" onclick="setSigType('digital')" id="btn-digital">
    📎 תמונה משולבת
  </button>
</div>

<!-- אפשרות 1: ציור חתימה + העלאת חותמת -->
<div id="sig-drawn-section">
  <div class="field-group">
    <label class="field-label">חותמת חברה (אופציונלי)</label>
    <input type="file" id="stampFileInput" accept="image/*"/>
    <img id="stampPreview" style="max-width:120px;display:none;margin-top:8px;"/>
  </div>
  <div class="field-group">
    <label class="field-label">חתימה *</label>
    <canvas id="sigCanvas" width="640" height="220"></canvas>
    <button class="canvas-clear" onclick="clearCanvas()">× נקה חתימה</button>
  </div>
</div>

<!-- אפשרות 2: תמונה משולבת -->
<div id="sig-digital-section" style="display:none">
  <div class="field-group">
    <label class="field-label">העלה תמונת חתימה + חותמת</label>
    <input type="file" id="digitalSigInput" accept="image/*"/>
    <img id="digitalSigPreview" style="max-width:280px;display:none;margin-top:8px;"/>
  </div>
</div>

<script>
let currentSigType = 'drawn';
let stampB64 = '';
let digitalSigB64 = '';

function setSigType(type) {
  currentSigType = type;
  document.getElementById('sig-drawn-section').style.display = type === 'drawn' ? 'block' : 'none';
  document.getElementById('sig-digital-section').style.display = type === 'digital' ? 'block' : 'none';
  document.getElementById('btn-drawn').classList.toggle('active', type === 'drawn');
  document.getElementById('btn-digital').classList.toggle('active', type === 'digital');
}

document.getElementById('stampFileInput').addEventListener('change', function(e) {
  const f = e.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = function() {
    stampB64 = reader.result;
    document.getElementById('stampPreview').src = stampB64;
    document.getElementById('stampPreview').style.display = 'block';
  };
  reader.readAsDataURL(f);
});

document.getElementById('digitalSigInput').addEventListener('change', function(e) {
  const f = e.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = function() {
    digitalSigB64 = reader.result;
    document.getElementById('digitalSigPreview').src = digitalSigB64;
    document.getElementById('digitalSigPreview').style.display = 'block';
  };
  reader.readAsDataURL(f);
});
</script>
```

### 4. עדכון `submitSignature()` בtemplate
```javascript
// בpayload לsign-quote:
const payload = {
  quote_id: '...',
  signer_name: name,
  signer_email: email,
  signature_type: currentSigType,
  signature_b64: currentSigType === 'drawn' ? canvas.toDataURL('image/png') : digitalSigB64,
  stamp_image_b64: currentSigType === 'drawn' ? (stampB64 || null) : null,
  // ...שאר השדות הקיימים
};

// Validation
if (currentSigType === 'drawn' && !hasSig) { showErr('errSig'); return; }
if (currentSigType === 'digital' && !digitalSigB64) { alert('יש להעלות תמונת חתימה'); return; }
```

### 5. `sign-quote/index.ts` — קליטת השדות החדשים
```typescript
const { signature_type = 'drawn', stamp_image_b64, signature_b64, ... } = body;

let stampUrl = null;
if (stamp_image_b64) {
  // upload to signature-stamps bucket
  const stampFilename = `${sigId}-stamp.png`;
  const stampBytes = decodeBase64(stamp_image_b64.split(',')[1]);
  const { error: stampErr } = await supabase.storage
    .from("signature-stamps")
    .upload(stampFilename, stampBytes, { contentType: "image/png" });
  if (!stampErr) {
    const { data } = await supabase.storage
      .from("signature-stamps")
      .createSignedUrl(stampFilename, 60 * 60 * 24 * 365 * 7);  // 7 שנים
    stampUrl = data?.signedUrl;
  }
}

await supabase.from("quote_signatures").insert({
  ...existing,
  signature_type,
  stamp_image_url: stampUrl,
});

// העברה ל-pdf-generator כולל stamp_image_url
```

### 6. `pdf-generator/index.js` — הזרקת חותמת ב-overlay
```javascript
// אם stamp_image_url קיים, הצגתו מאחורי החתימה:
${stamp_image_url ? `
  <img src="${stamp_image_url}"
       style="position:absolute; top:50%; left:50%;
              transform:translate(-50%,-50%); opacity:0.25;
              width:180px; pointer-events:none;"/>
` : ''}
```

**זמן Task 2B:** ~2 שעות

---

## סיכום סדר ביצוע + זמנים

| שלב | משימה | זמן | תלות |
|---|---|---|---|
| 0 | Pre-Work (DB, Storage, Worker, secrets) | 45 דק' | — |
| 1 | **Task 2A** — PDF מלא | 90 דק' | Pre-Work |
| 2 | **Task 3** — כפתור PDF preview | 60 דק' | Task 2A (משתמש ב-pdf-generator + proxy) |
| 3 | **Task 1** — Auto-deploy via Storage | 75 דק' | Pre-Work |
| 4 | **Task 2B** — חתימה דואלית | 120 דק' | Task 2A |

**סה"כ:** ~6.5 שעות עבודה מצטברות (ללא debug + tests).

---

## אבטחה — סיכום מצב

| נושא | סטטוס | פעולה |
|---|---|---|
| PDF_GENERATOR_SECRET | ✅ מוסתר בEdge Function (pdf-proxy) | ביצוע ב-Task 3 |
| Tokens גולמיים בDB | ⚠️ דחוי לPhase 3 | UUID v4 — סיכון נמוך ב-10/חודש |
| Storage bucket private | ✅ Worker fetch עם service_key | ביצוע ב-Pre-Work |
| Idempotency חתימות | ✅ UNIQUE constraint | ביצוע ב-Pre-Work |
| CORS על Edge Functions | ✅ קיים | ללא שינוי |

---

## מה דחיתי לPhase 3 (ולמה)

1. **Hashed tokens** — UUID v4 = 128-bit entropy. 10 הצעות/חודש = 120/שנה. ניחוש מעשי בלתי אפשרי. ROI עכשיו נמוך.
2. **Quote ID auto-increment** — דרור מזין ידני. נחמד אבל לא חוסם.
3. **Dashboard לאדמין** — עדיין יד שורפת. Phase 3 כשהvolume יגדל.
4. **WhatsApp notifications** — מייל ראשון. Cloud API דורש הקמה מוצדקת בvolume גבוה.
5. **Cloud Run pre-warm** — 10/חודש = 1 לכל 3 ימים. cold start פעם בשבוע = OK.

---

## בעיות שעלולות להתעורר (גזרת זהירות)

1. **`page.setContent()` עם HTML גדול** — quote-template-v1.html = ~70KB. צריך לוודא ש-`waitUntil: 'networkidle'` לא נכשל ב-fonts loading.
2. **Cloudflare Worker → Supabase Storage** — Cold cache → 200-500ms פעם ראשונה. מקובל.
3. **HTML שמור ב-DB** — quote-template עם base64 logo יכול להגיע ל-500KB. אם זה בעיה — לאחסן רק את ה-data ולבנות HTML on-demand.
4. **`upload: true` (upsert) ב-Storage** — אם דרור שולח אותה quote_id פעמיים, הקובץ ידרס. **נכון** עבור עדכון הצעה. **לא נכון** אם תקלת human error. אזהרה ב-UI מומלצת.

---

## כללי עבודה (מסיכום קודם)

1. Agent tool אסור לשינויי קוד ללא אישור.
2. דרור = ידיים. Claude = מנחה.
3. לא שולחים מיילים, לא מוחקים קבצים.
4. שפה: עברית.
5. סגנון: משפטים קצרים.

---

**נקודת המשך:** מתחילים מ-**Pre-Work** (יצירת bucket + טבלה + worker update). אחרי אישור — Task 2A.
