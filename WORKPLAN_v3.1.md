# CargoNex Quote-Gen — תכנית עבודה מפורטת

**גרסה:** 3.1 (מאומתת מול קוד)
**תאריך:** 2026-06-08
**בסיס:** PRD v1.3 + GAP_ANALYSIS v1.0 + סריקת קוד מלאה + אימות שורות
**מטרה:** לסגור את כל ה-Phase 2 open items — המוצר מוכן לשליחה ללקוח אמיתי

> **שינויים מ-v3.0:** 3 תיקונים אחרי אימות מול הקוד —
> 🔧 **C1 (קריטי):** Dockerfile build context — `assets/` מחוץ לתיקיית הbuild. תוקן בשינוי 7 + 4א.
> 🔧 **C2:** `strokeStyle` נמצא ב-2 שורות (1711 + 1715), לא אחת. תוקן בשינוי 2.
> 🔧 **C3:** פתרון GAP-05 עדיף — `filter:invert(1)` ב-PDF, בלי לגעת בעמוד החי. תוקן בשאלה 1 + שינוי 4ו.

---

## סטטוס: ✅ מאושר לביצוע — כל ההחלטות נעולות

**החלטות שננעלו (2026-06-08):**
1. **חתימה → אופציה A (invert ב-PDF).** אפס שינוי בעמוד החי.
2. **שני הצדדים סימטריים לחלוטין** — אותם 4 שדות בכל צד: **שם מלא · תפקיד · חתימה · תאריך**.
3. **צד CargoNex לא נכתב "נציג CargoNex"** — מקבל את אותם 4 שדות, ריקים/מקווקו להשלמה ידנית (אין נכס חתימה ל-CargoNex עדיין).

---

## מה עובד כבר (אל תיגע)
- Generator form → upload-quote → quotes table + quotes-html bucket ✅
- Token + expiry validation (quote_tokens) ✅
- Dark quote template (live page) — פנל חתימה, canvas, stamp upload, expiry state ✅
- sign-quote: שמירת signature ל-DB, העלאת stamp, קריאה ל-pdf-generator (כבר שולח `stamp_image_url`) ✅
- pdf-generator: מייצר PDF לבן, מעלה ל-signed-quotes, מייל דרך Resend ✅
- calcTotal, Hebrew date, RTL footer, Public URL, Admin alter ✅

**אומת בסריקה:** `{{OWNER_NAME}}` קיים בתבנית (שורה 1494) · `signerPhone` שורה 1518 · payload שורה 1973 · `_pendingDownload` + `downloadPreviewPDF` + `closePreview` + `#previewTopBar` קיימים ב-generator.

---

## 7 שינויים נדרשים — לפי קובץ

---

### שינוי 1 — `supabase/migrations/` — קובץ חדש
**גורר:** sign-quote, buildPrintHtml (3, 4)
**קובץ חדש:** `supabase/migrations/20260608_add_signer_role.sql`
```sql
ALTER TABLE quote_signatures
  ADD COLUMN IF NOT EXISTS signer_role TEXT;
```
**⚠️ להריץ ב-Supabase לפני deploy של sign-quote.** בלי זה ה-INSERT ייכשל.

---

### שינוי 2 — `quote-template-v1.html`
**גורר:** sign-quote (3)

**א. שדה `signer_role` בטופס** — אחרי `signerPhone` (שורה ~1519):
```html
<div class="field-group">
  <label class="field-label" for="signerRole">תפקיד / מורשה חתימה *</label>
  <input class="field-input rtl" type="text" id="signerRole"
    placeholder="מנכ&quot;ל / סמנכ&quot;ל / מורשה חתימה" autocomplete="organization-title" />
  <div class="field-error" id="errRole">נא להזין תפקיד</div>
</div>
```

**ב. validation ב-`submitSignature()`** — ליד שורה ~1955 (אחרי `phone`):
```javascript
const role = document.getElementById('signerRole').value.trim();
if (!role) { showErr('errRole'); valid = false; }
```

**ג. הוסף `signer_role` + `sender_name` ל-payload** (שורה 1973):
```javascript
body: JSON.stringify({
  quote_id: QUOTE_ID, signer_name: name, signer_email: email, signer_phone: phone,
  signer_role: role,                 // NEW
  sender_name: '{{OWNER_NAME}}',     // NEW — אומת: placeholder קיים בשורה 1494
  signature_b64: sigBase64, stamp_image_b64: stampBase64, signature_type: currentSigType,
  client_name: '{{CLIENT_COMPANY}}', setup_fee: '{{SETUP_FEE_DISPLAY}}',
  monthly_fee: '{{MONTHLY_FEE_DISPLAY}}', owner_email: '{{OWNER_EMAIL}}',
  token: new URLSearchParams(window.location.search).get('t'), session_id: SESSION_ID
})
```

**ד. hideErr לשדה role:**
```javascript
document.getElementById('signerRole').addEventListener('input', () => hideErr('errRole'));
```

**ה. 🔧 C2 — צבע דיו (GAP-05) — ✅ נסגר: אופציה A (invert).**
`strokeStyle = '#FFFFFF'` נמצא ב-2 שורות (1711 mousemove, 1715 touchmove).
**→ אל תיגע בשורות האלה.** הפתרון כולו ב-PDF (`filter:invert(1)`, שינוי 4ו). אפס שינוי בעמוד החי.

---

### שינוי 3 — `supabase/functions/sign-quote/index.ts`
**גורר:** pdf-generator (4)

**א. destructure** (שורה ~25): הוסף `signer_role, sender_name`.

**ב. INSERT** — הוסף `signer_role: signer_role || null,`.

**ג. תקן stamp URL (GAP-14)** — block הstamp (שורות ~80-85):
```typescript
if (!stampErr) {
  const { data: stampData } = supabase.storage
    .from("signature-stamps").getPublicUrl(stampFilename);
  stampUrl = stampData?.publicUrl || null;
}
```
**⚠️ תנאי מוקדם:** הפוך `signature-stamps` ל-**public** ב-Supabase Storage. בלי זה getPublicUrl יחזיר URL לא נגיש.

**ד. הוסף לpayload ל-pdf-generator** (שורה ~145):
```typescript
signer_role: signer_role || "",
signer_phone: signer_phone || "",
sender_name: sender_name || "",
```
(`stamp_image_url` כבר נשלח — אומת בשורה 158.)

---

### שינוי 4 — `pdf-generator/index.js`
**הכי מורכב. 6 תת-שינויים. לא גורר קבצים אחרים.**

**א. 🔧 C1 — לוגו base64 בתחילת הקובץ** (אחרי imports):
```javascript
import { readFileSync } from "fs";
import { resolve } from "path";
let LOGO_BASE64 = "";
try {
  // 🔧 C1: הלוגו יושב בתוך build context של pdf-generator (ראה שינוי 7)
  const logoPath = resolve(process.env.LOGO_PATH || "./assets/cargonex-logo.png");
  LOGO_BASE64 = `data:image/png;base64,${readFileSync(logoPath).toString("base64")}`;
} catch (e) {
  console.warn("[STARTUP] Logo not found — text fallback:", e.message);
}
```
> 🔧 **C1 הערה:** שונה ל-path יחסי `./assets/` + שם קובץ **בלי רווח** (`cargonex-logo.png`). ראה שינוי 7.

**ב. `/generate-pdf` destructure** (שורה ~44): הוסף `signer_role, signer_phone, sender_name, stamp_image_url`.

**ג. קריאה ל-`buildPrintHtml` ב-`/generate-pdf`:** הוסף
`signer_role, signer_phone, sender_name, stamp_image_url` ו-`mode: "signed"`.

**ד. `/preview-pdf`:** הוסף `const { html, stamp_b64 } = req.body;`, ובקריאה ל-buildPrintHtml הוסף
`stamp_image_url: stamp_b64 || ""` ו-`mode: "preview"` (שאר שדות החותם ריקים).

**ה. signature של `buildPrintHtml`:** הוסף params עם defaults:
`signer_role="", signer_phone="", sender_name="", stamp_image_url="", mode="signed"`.

**ו. שינויי HTML ב-`buildPrintHtml`:**

**1. Header — לוגו + watermark (signed בלבד):**
```javascript
`<div class="pdf-header">
  <div>
    ${LOGO_BASE64
      ? `<img src="${LOGO_BASE64}" alt="CargoNex" style="height:48px;object-fit:contain;"/>`
      : `<div class="pdf-logo">CargoNex</div>`}
    ${mode === "signed" ? `<div class="signed-badge">✓ נחתם</div>` : ""}
  </div>
  <div class="pdf-meta"><strong>${esc(quote_id)}</strong>מספר הצעה</div>
</div>
${mode === "signed" ? `<div class="watermark">נחתם</div>` : ""}`
```

**2. CSS — watermark + 🔧 C3 תיקון חתימה:**
```css
.watermark{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-35deg);
  font-size:96px;font-weight:900;color:rgba(231,76,60,0.08);pointer-events:none;z-index:0;
  white-space:nowrap;letter-spacing:0.1em;}
/* 🔧 C3 — GAP-05: invert הופך קווים לבנים → שחורים, שקוף נשאר שקוף */
.sig-img{max-width:220px;max-height:80px;display:block;margin:0 auto 10px;
  border:1px solid #ddd;border-radius:4px;background:#fff;padding:4px;filter:invert(1);}
```
> 🔧 **C3:** עם `filter:invert(1)` **אין צורך לשנות את עמוד החי**. אם בכל זאת תבחר דיו שחור (שינוי 2ה אופציה B) — הסר את ה-`filter:invert(1)` ושנה background ל-`#fff`.

**3. `signer_role` + `signer_phone` ל-`client-block`** — החלף את שורת אימייל ב:
```html
<div class="meta-item"><label>תפקיד</label><span>${esc(signer_role) || "—"}</span></div>
<div class="meta-item"><label>טלפון</label><span>${esc(signer_phone) || "—"}</span></div>
<div class="meta-item"><label>אימייל</label><span>${esc(signer_email)}</span></div>
```
> הערה: ב-preview שדות אלו יציגו "—" (אין חותם). מקובל.

**4. placeholder ל-sections ריקים (GAP-13):**
```javascript
${pains.length ? `<div class="section">...</div>`
  : `<div class="section"><p style="color:#aaa;font-size:12px;font-style:italic;">לא הוגדרו נקודות כאב.</p></div>`}
${benefits.length ? `<div class="section">...</div>`
  : `<div class="section"><p style="color:#aaa;font-size:12px;font-style:italic;">לא הוגדרו תועלות.</p></div>`}
```

**5. "מה הצעד הבא?" לפני footer (GAP-11):**
```html
<div style="padding:14px 28px;background:#fafafa;border-top:1px solid #eee;page-break-inside:avoid;">
  <div style="font-size:12px;color:#E74C3C;font-weight:700;margin-bottom:6px;">✅ מה קורה עכשיו?</div>
  <div style="font-size:12px;color:#555;line-height:1.7;">
    ${esc(sender_name) || "נציג CargoNex"} ייצור קשר תוך 24 שעות לקביעת kickoff.<br/>
    לכל שאלה: <span style="direction:ltr;display:inline-block;">${esc(owner_email)}</span>
  </div>
</div>
```

**6. sig-section — PREVIEW vs SIGNED — ✅ שני בלוקים סימטריים לחלוטין.**
**אותם 4 שדות בכל צד (לקוח + CargoNex): שם מלא · תפקיד · חתימה · תאריך + אזור חותמת.**
- **SIGNED:** צד לקוח מולא מהחתימה האלקטרונית (תמונת חתימה עם `filter:invert(1)`, שם, תפקיד, תאריך, חותמת אם הועלתה). צד CargoNex — אותם 4 שדות **ריקים/מקווקו** + אזור חותמת ריק (אין נכס חתימה ל-CargoNex). **אין טקסט "נציג CargoNex"** — רק תוויות השדות.
- **PREVIEW:** שני הצדדים ריקים/מקווקו עם אותן 4 תוויות + אזור חותמת — להשלמה ידנית.
- כותרות צד: "הלקוח" | "CargoNex". תוויות שדה זהות בשני הצדדים.

**7. label (GAP-12):** `"ההצעה הכלכלית"` → `"ההצעה הכספית"`.

---

### שינוי 5 — `supabase/functions/pdf-proxy/index.ts`
**גורר:** generator.html (6)
```typescript
const { html, quote_id, stamp_b64 } = await req.json();
// ...
body: JSON.stringify({ html, quote_id, stamp_b64: stamp_b64 || "" }),
```

---

### שינוי 6 — `generator.html`
**תלוי ב:** pdf-proxy (5)

**א. stamp upload ל-`#previewTopBar`** (לפני הכפתורים, שורה ~1429):
```html
<div style="display:flex;align-items:center;gap:10px;flex-shrink:0;">
  <label style="font-size:13px;color:rgba(255,255,255,0.5);white-space:nowrap;">חותמת (PDF):</label>
  <input type="file" id="previewStampInput" accept="image/*"
    style="font-size:12px;color:rgba(255,255,255,0.5);max-width:140px;"/>
</div>
```

**ב. קריאת stamp:**
```javascript
let _previewStampB64 = '';
document.getElementById('previewStampInput').addEventListener('change', function(e){
  const f = e.target.files[0]; if(!f) return;
  const r = new FileReader(); r.onload = () => { _previewStampB64 = r.result; }; r.readAsDataURL(f);
});
```

**ג. `downloadPreviewPDF()` (שורה 1360)** — עדכן body:
```javascript
body: JSON.stringify({ html: _pendingDownload.html, quote_id: _pendingDownload.quoteId,
  stamp_b64: _previewStampB64 || "" })   // NEW
```

**ד. נקה ב-`closePreview()` (שורה 1346):**
```javascript
_previewStampB64 = '';
var ps = document.getElementById('previewStampInput'); if (ps) ps.value = '';
```

---

### שינוי 7 — 🔧 C1 — `pdf-generator/Dockerfile` + העתקת לוגו
**הבעיה שאומתה:** ה-Dockerfile עושה `COPY index.js ./` בלבד, וה-build רץ מתוך `pdf-generator/` (`cd pdf-generator` לפי ADR). תיקיית `assets/` נמצאת בשורש הפרויקט — **מחוץ ל-build context**. `COPY assets/` מהשורש **ייכשל**.

**הפתרון (2 צעדים):**

1. צור עותק של הלוגו בתוך תיקיית ה-build, בשם בלי רווח:
   `pdf-generator/assets/cargonex-logo.png`  ← העתק מ-`assets/cargonex logo.png`

2. ב-`Dockerfile`, לפני ה-CMD, הוסף:
```dockerfile
# Copy embedded assets (logo for PDF header)
COPY assets/ ./assets/
```
(התוצאה: `/app/assets/cargonex-logo.png` — תואם ל-LOGO_PATH בשינוי 4א.)

> **חלופה (אם לא רוצים כפילות קובץ):** לבנות מהשורש עם `gcloud builds submit` + `-f pdf-generator/Dockerfile` ולשנות נתיבי COPY. פחות מומלץ — משנה את פקודות ה-deploy הקיימות ב-ADR. עדיף הצעד הפשוט למעלה.

---

## סדר ביצוע מחייב
```
1. שינוי 1   — Migration → הרץ ב-Supabase
2. שינוי 7   — 🔧 העתק לוגו ל-pdf-generator/assets/ + Dockerfile (קודם — תנאי ללוגו)
3. שינוי 4ה  — buildPrintHtml signature (params + defaults)
4. שינוי 4ו  — HTML של buildPrintHtml (logo, watermark, sig blocks, invert, placeholders, next-step, label)
5. שינוי 4ב-ד — routes /generate-pdf + /preview-pdf
6. שינוי 4א  — לוגו base64 + import
7. שינוי 3   — sign-quote (destructure + INSERT + stamp URL + payload)
8. שינוי 5   — pdf-proxy (stamp_b64)
9. שינוי 2   — quote-template (signer_role; דיו רק אם אופציה B)
10. שינוי 6  — generator (preview stamp)
```

**Deploy order:**
1. Migration (Supabase)
2. `signature-stamps` bucket → Make public
3. Deploy `sign-quote`
4. Deploy `pdf-proxy`
5. Build + push pdf-generator (Cloud Run) — לוודא שהלוגו בתוך assets/ של ה-context
6. template/generator — static, אין deploy נפרד

---

## החלטות שננעלו ✅

### שאלה 1 — נראות חתימה (GAP-05) → **אופציה A (invert)**
`filter:invert(1)` על `.sig-img` ב-PDF בלבד. חתימה שחורה על PDF לבן, עמוד חי נשאר לבן-על-כהה. אפס שינוי בעמוד החי.

### שאלות 2+3 — צד CargoNex → **סימטרי, אותם 4 שדות**
שני הצדדים זהים: שם מלא · תפקיד · חתימה · תאריך + אזור חותמת. **אין "נציג CargoNex".** צד CargoNex ריק/מקווקו להשלמה ידנית (אין נכס חתימה).

### ⚠️ שאלה 4 — digital mode (לתשומת לב בביצוע, לא חוסם)
בmode "digital" המשתמש מעלה תמונה משולבת שכבר שחורה-על-לבן. **אסור להחיל invert עליה** — תתהפך לשלילי.
**פתרון:** `filter:invert(1)` רק על drawn signature. צור class נפרד (למשל `.sig-img-drawn` עם invert, `.sig-img-digital` בלי) ובחר לפי `signature_type`. **מאושר לביצוע כך.**

---

## Definition of Done — Phase 2
- [ ] `signer_role` בטופס → DB → PDF
- [ ] `signer_phone` ב-PDF
- [ ] לוגו CargoNex אמיתי ב-header (Dockerfile assets עובד)
- [ ] חתימה נראית על PDF לבן (לפי שאלה 1)
- [ ] חותמת לקוח ב-PDF חתום
- [ ] שני blocks סימטריים (client + CargoNex) ב-signed
- [ ] שני blocks ריקים ב-preview
- [ ] Watermark "נחתם" ב-signed בלבד
- [ ] "מה הצעד הבא?" לפני footer
- [ ] stamp upload ב-preview modal
- [ ] stamp URL לא יפוג (getPublicUrl + bucket public)
- [ ] Section ריק → placeholder
- [ ] "ההצעה הכספית"

---

## קבצים שלא ישתנו
upload-quote · send-quote-links · track-event · 20260526_quote_tokens.sql · quotes/worker.js · quotes/wrangler.toml · DESIGN.md

---
*WORKPLAN v3.1 — CargoNex Quote-Gen — 2026-06-08 — מאומת מול קוד*
