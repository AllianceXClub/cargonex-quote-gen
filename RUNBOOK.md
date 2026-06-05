# RUNBOOK — CargoNex Quote-Gen
## תכנית ביצוע שלב-אחר-שלב

**תאריך:** 2026-05-31  
**מי מבצע:** דרור (ידיים)  
**הכנה מוקדמת:**
- פתח Terminal ו-browser לפני שמתחיל
- ודא שאתה מחובר ל: Supabase dashboard, Google Cloud Console, Resend, UptimeRobot

---

## יום 1 — לקוח תמיד יכול לגשת ל-PDF שלו

**מה נשבר עכשיו:** קישורי PDF פגים אחרי 7 ימים → 403. לקוח מאבד גישה למסמך חתימה.  
**מה עושים:** עושים bucket ציבורי + URL קבוע + אין cold start.

**זמן כולל: ~45 דקות**

---

### שלב 1 — הפוך את bucket ה-`signed-quotes` לציבורי
**איפה:** [supabase.com](https://supabase.com) → Project: quota-gen → **Storage**

1. לחץ על הטאב **Storage** בתפריט הצד
2. לחץ על ה-bucket **`signed-quotes`**
3. לחץ על שלוש הנקודות (...) ליד שמו → **Edit bucket**
4. הפעל **Public bucket** (toggle)
5. לחץ **Save**

**תוצאה צפויה:** ייצג badge "Public" ליד שם ה-bucket.

---

### שלב 2 — עדכן `pdf-generator/index.js` — החלף signed URL ב-public URL

**פתח:** `pdf-generator/index.js`

**מצא את הקוד הזה (שורות ~161-167):**
```javascript
    // Get signed URL (7 days)
    const { data: urlData, error: urlError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(filename, SIGNED_URL_EXPIRY_SECS);

    if (urlError) throw new Error(`Signed URL failed: ${urlError.message}`);
    const pdfUrl = urlData.signedUrl;
```

**החלף ב:**
```javascript
    // Get permanent public URL (bucket must be public)
    const { data: { publicUrl: pdfUrl } } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(filename);
```

**בנוסף — בשורה 28, מחק את הקו הזה (לא נחוץ יותר):**
```javascript
const SIGNED_URL_EXPIRY_SECS = 7 * 24 * 60 * 60; // 7 days
```

---

### שלב 3 — הסר `ws` import מ-`pdf-generator/index.js`

**מצא בראש הקובץ:**
```javascript
import ws from "ws";
```
**מחק את השורה הזו.**

**מצא את יצירת Supabase client (שורות ~30-32):**
```javascript
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  realtime: { transport: ws },
});
```
**החלף ב:**
```javascript
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
```

---

### שלב 4 — הוסף validation של env vars בסטארטאפ

**בראש הקובץ, מיד אחרי הגדרת כל ה-const (לפני `const supabase = ...`), הוסף:**
```javascript
// Fail fast — don't start if critical env vars are missing
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !PDF_GENERATOR_SECRET || !RESEND_API_KEY) {
  console.error("[STARTUP] Missing required env vars. Refusing to start.");
  process.exit(1);
}
```

---

### שלב 5 — בנה ודפלוי pdf-generator ל-Cloud Run

**Terminal → תיקיית הפרויקט:**
```bash
cd pdf-generator
gcloud builds submit --tag europe-west1-docker.pkg.dev/quota-gen/pdf-generator/pdf-generator:latest
```
⏱ ממתין ~5-10 דקות לבנייה.

**תוצאה צפויה:** `SUCCESS` בסוף הלוג, image tag יופיע ב-Artifact Registry.

```bash
gcloud run deploy pdf-generator \
  --image europe-west1-docker.pkg.dev/quota-gen/pdf-generator/pdf-generator:latest \
  --region europe-west1 \
  --min-instances=1
```
⏱ ממתין ~2-3 דקות.

**תוצאה צפויה:** `Service [pdf-generator] revision [pdf-generator-XXXXX] has been deployed and is serving 100 percent of traffic.`

---

### שלב 6 — ודא ש-min-instances=1 מוגדר

```bash
gcloud run services describe pdf-generator \
  --region europe-west1 \
  --format="value(spec.template.spec.containerConcurrency,spec.template.metadata.annotations)"
```

אם לא רואה `autoscaling.knative.dev/minScale: '1'` — הרץ:
```bash
gcloud run services update pdf-generator \
  --min-instances=1 \
  --region europe-west1 \
  --project=quota-gen
```

---

### שלב 7 — תקן URL קיימים ב-DB (backfill)

**איפה:** Supabase dashboard → **SQL Editor** → לחץ **New query**

**הדבק והרץ:**
```sql
-- בדיקה תחילה — כמה רשומות מושפעות?
SELECT COUNT(*) 
FROM quote_signatures 
WHERE pdf_url IS NOT NULL AND pdf_url LIKE '%/token=%';
```

**ודא שהמספר הגיוני** (כמה חתימות יש לך). אז הרץ את ה-UPDATE:

```sql
UPDATE quote_signatures
SET pdf_url = CONCAT(
  'https://tjitewgiszukqyjujxrh.supabase.co/storage/v1/object/public/signed-quotes/',
  REGEXP_REPLACE(pdf_url, '^.*signed-quotes/([^?]+).*$', '\1')
)
WHERE pdf_url IS NOT NULL AND pdf_url LIKE '%/token=%';
```

**תוצאה צפויה:** `UPDATE N` — כמספר הרשומות שמצאת בשאילתת הבדיקה.

**ודא:** לחץ על אחת הרשומות ב-`quote_signatures` → `pdf_url` צריך להתחיל ב-`https://...supabase.co/storage/v1/object/public/signed-quotes/...` (בלי `?token=`).

---

### שלב 8 — הגדר UptimeRobot (חינם)

1. פתח [uptimerobot.com](https://uptimerobot.com) → התחבר/הירשם
2. לחץ **Add New Monitor**
3. מלא:
   - **Monitor Type:** HTTP(s)
   - **Friendly Name:** CargoNex PDF Generator
   - **URL:** `https://pdf-generator-641138828646.europe-west1.run.app/health`
   - **Monitoring Interval:** 5 minutes
4. תחת **Alert Contacts** → הוסף `dror@cargonex.io`
5. לחץ **Create Monitor**

**ודא:** המוניטור מציג "Up" ירוק תוך ~5 דקות.

---

### ✅ סיום יום 1 — בדיקת תקינות

```bash
# בדוק שה-health endpoint עונה:
curl https://pdf-generator-641138828646.europe-west1.run.app/health
```
**תוצאה צפויה:** `{"ok":true}` או דומה.

בדוק PDF ישן: פתח `pdf_url` ישן מה-DB — צריך להיפתח בלי 403.

---

## יום 2 — כשל שקט הופך גלוי

**מה נשבר עכשיו:** אם pdf-generator נופל — הלקוח קיבל 200 OK אבל לא מקבל PDF. אין התראה.  
**מה עושים:** admin alert כשה-PDF נכשל + deploy כל ה-edge functions.

**זמן כולל: ~55 דקות**

---

### שלב 9 — הוסף failure tracking ל-`sign-quote`

**פתח:** `supabase/functions/sign-quote/index.ts`

**מצא את הקוד הזה (שורות ~138-159):**
```typescript
    // Fire PDF generation — async, no await (don't block the response)
    fetch(PDF_GENERATOR_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${PDF_GENERATOR_SECRET}`,
      },
      body: JSON.stringify({
        ...
      }),
    }).catch((e) => console.error("PDF generator call failed:", e));
```

**החלף את ה-`fetch(...).catch(...)` block בשלמותו ב:**
```typescript
    // Fire PDF generation — tracked (admin alert on failure)
    const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") || "";
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";

    fetch(PDF_GENERATOR_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${PDF_GENERATOR_SECRET}`,
      },
      body: JSON.stringify({
        signature_id: sigId,
        quote_id,
        signer_name,
        signer_email,
        client_name: client_name || "",
        signed_at: signedAt,
        setup_fee,
        monthly_fee,
        signature_b64,
        owner_email: owner_email || "",
        viewer_emails: viewerEmails,
        quote_html,
        stamp_image_url: stampUrl,
      }),
    }).then(async (r) => {
      if (!r.ok) {
        const errText = await r.text().catch(() => "unknown");
        console.error(`[PDF FAIL] ${quote_id}: HTTP ${r.status} — ${errText}`);
        if (ADMIN_EMAIL && RESEND_API_KEY) {
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${RESEND_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: "CargoNex Alerts <hello@cargonex.io>",
              to: [ADMIN_EMAIL],
              subject: `🚨 PDF נכשל — ${quote_id}`,
              html: `<div dir="rtl" style="font-family:Arial,sans-serif;padding:24px;">
                <h2 style="color:#E74C3C;">⚠️ PDF Generation Failed</h2>
                <p><strong>Quote ID:</strong> ${quote_id}</p>
                <p><strong>Signer:</strong> ${signer_name} &lt;${signer_email}&gt;</p>
                <p><strong>HTTP Status:</strong> ${r.status}</p>
                <p><strong>Error:</strong> ${errText}</p>
                <p style="color:#888;font-size:13px;">הלקוח לא קיבל את ה-PDF. יש לשלוח ידנית.</p>
              </div>`,
            }),
          }).catch(() => {});
        }
      }
    }).catch((e) => {
      console.error(`[PDF CALL FAIL] ${quote_id}:`, e.message);
    });
```

---

### שלב 10 — הגדר secrets ב-Supabase

```bash
# ודא שאתה ב-root של הפרויקט:
supabase secrets set ADMIN_EMAIL=dror@cargonex.io --project-ref tjitewgiszukqyjujxrh
supabase secrets set RESEND_API_KEY=re_XXXXXXXXXX --project-ref tjitewgiszukqyjujxrh
```
> 💡 החלף `re_XXXXXXXXXX` עם ה-API key האמיתי מ-Resend dashboard.

**ודא:**
```bash
supabase secrets list --project-ref tjitewgiszukqyjujxrh
```
צריך לראות `ADMIN_EMAIL` ו-`RESEND_API_KEY` ברשימה.

---

### שלב 11 — דפלוי edge functions

```bash
# מ-root של הפרויקט:
supabase functions deploy sign-quote --project-ref tjitewgiszukqyjujxrh
supabase functions deploy upload-quote --project-ref tjitewgiszukqyjujxrh
supabase functions deploy track-event --project-ref tjitewgiszukqyjujxrh
```

**תוצאה צפויה:** 3 פעמים `Deployed Function sign-quote/upload-quote/track-event on project tjitewgiszukqyjujxrh`

---

### שלב 12 — מחק את ה-generator.html המיותר ב-quotes/

**`quotes/generator.html`** הוא עותק ישן ולא מעודכן של `generator.html` ב-root. הוא מבלבל.

```bash
# ב-Windows — מחק ידנית בסייר הקבצים:
# C:\Projects\ClaudeCoWork\projects\Quote-Gen\Quote-Gen\quotes\generator.html
```
> ⚠️ לפני מחיקה — ודא שאין הפניות אליו מ-Cloudflare Worker.

**בדוק ב-`quotes/worker.js`:** חפש `generator` — אם לא מוזכר, בטוח למחוק.

---

### ✅ סיום יום 2 — ודא deployment

**בדוק ב-Supabase dashboard → Edge Functions:**
- `sign-quote` — Created/Updated עם תאריך של היום
- `upload-quote` — Created/Updated עם תאריך של היום  
- `track-event` — Created/Updated עם תאריך של היום

---

## יום 3 — E2E Test מלא

**מה בודקים:** כל ה-flow מ-generator עד PDF בתיבת הדואר.  
**זמן: ~30 דקות**

---

### שלב 13 — הכן סביבת test

```bash
# הרץ server מקומי מ-root של הפרויקט:
npx serve .
```
פתח browser: `http://localhost:3000/generator.html`

---

### שלב 14 — צור הצעה test

מלא בטופס:

| שדה | ערך לtest |
|-----|-----------|
| Quote ID | `test-e2e-001` |
| Client Name | `לקוח בדיקה` |
| Signer Name | השם שלך |
| Signer Email | כתובת שלך (שתקבל email) |
| Sender Email | `dror@cargonex.io` |
| Setup Fee | `5000` |
| Monthly Fee | `1000` |

1. לחץ **Preview** — ודא שהmodal נפתח עם תוכן נכון (לא שחור, עברית מוצגת)
2. לחץ **Download PDF** — ודא שה-PDF מוריד ונראה תקין
3. לחץ **Confirm & Send** — ודא שמופיע success alert עם URL

---

### שלב 15 — בדוק את דף החתימה

1. קח את ה-URL מה-success alert (או מה-email שהגיע)
2. פתח ב-**Incognito tab**
3. ✅ auth screen מופיע → נעלם אחרי שנייה → תוכן הצעה גלוי
4. גלול לסוף הדף → חתום בcanvas
5. סמן checkbox "אני מסכים"
6. לחץ **Sign & Accept**
7. ✅ מסך אישור מופיע

---

### שלב 16 — בדוק קבלת PDF

1. ✅ **ממתין 15-30 שניות**
2. בדוק email (הכתובת שמילאת כsigner) — מחפש נושא `ההצעה נחתמה`
3. לחץ על קישור ה-PDF
4. ✅ PDF נפתח — לא 403, לא שחור, חתימה נראית, עברית קריאה
5. ✅ בדוק email `dror@cargonex.io` — קיבלת גם את ה-PDF

---

### שלב 17 — ודא URL קבוע

בדוק את ה-URL של ה-PDF שקיבלת — צריך להיראות כך:
```
https://tjitewgiszukqyjujxrh.supabase.co/storage/v1/object/public/signed-quotes/test-e2e-001-XXXXX.pdf
```
**בלי** `?token=` בסוף.

פתח אותו שוב בtab חדש — ✅ עובד. זה URL קבוע ולא יפוג.

---

### שלב 18 — ודא התראות אדמין

בדוק `dror@cargonex.io` — צריך לקבל:
- ✅ "הצעה נפתחה לראשונה" — כשפתחת בincognito
- ✅ "הצעה נחתמה!" — כשחתמת
- ✅ הPDF עצמו (אותו email כמו הלקוח)

---

### שלב 19 — ודא DB

**Supabase → Table Editor → `quote_signatures`:**
- שורה חדשה עם `quote_id = 'test-e2e-001'`
- `pdf_url` מתחיל ב-`https://.../public/signed-quotes/...` (URL קבוע)
- `signature_image` מכיל base64 (לא null)

---

## סיכום — מה השגנו

| מה | לפני | אחרי |
|----|------|------|
| קישור PDF | פג אחרי 7 ימים | קבוע לתמיד |
| Cold start | 8-15 שניות | 0 (always warm) |
| PDF נכשל בשקט | כן | alert ל-dror@cargonex.io |
| Bot detection | אחרי insert | לפני insert |
| Token ב-sign-quote | אופציונלי | חובה |
| owner_email | לא זרם | זורם generator → upload → send |
| Monitoring | אין | UptimeRobot כל 5 דקות |

---

## אם משהו נשבר

**pdf-generator לא עונה:**
```bash
gcloud run services logs pdf-generator --region europe-west1 --limit 50
```

**Edge function נכשלת:**
- Supabase dashboard → **Edge Functions** → **Logs** → בחר את הfunction

**PDF שחור / לא נטען:**
- תבדוק שה-bucket `signed-quotes` מוגדר Public
- תבדוק logs של pdf-generator ב-Cloud Run

**לא קיבלת email:**
- Resend dashboard → Logs — חפש שגיאה
- ודא ש-`RESEND_API_KEY` מוגדר כsecret בSupabase

---

*RUNBOOK-001 — CargoNex Quote-Gen — 2026-05-31*
