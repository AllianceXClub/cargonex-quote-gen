# ADR-001: Customer-Facing PDF Delivery — Working Plan

**Status:** Accepted — In Execution
**Date:** 2026-05-30
**Decider:** Dror
**Context source:** CODE_REVIEW.md + TECH_DEBT.md (this session)
**Constraint:** ~10 quotes/month (Phase 1). ROI at minimal cost.

---

## The One Thing That Matters

> A customer signs a quote. They must receive a PDF — reliably, fast, and permanently accessible.

Everything else is secondary to this. The entire system exists to produce this outcome.

---

## Current Flow (Post-Fixes Applied This Session)

```
Customer signs
    ↓
quote-template-v1.html
    → POST /sign-quote (Edge Function)
        ✅ Token validated (required, not optional — fixed)
        ✅ Stamp uploaded to Storage BEFORE DB insert — fixed
        ✅ DB insert → quote_signatures
        → fetch quote_html from quotes table
        → fetch viewer emails from quote_tokens
        → POST pdf-generator/generate-pdf (Cloud Run) [fire-and-forget]
        ← 200 OK to customer ("signed successfully")

pdf-generator (Cloud Run + Playwright)
    ✅ Route blocking — analytics calls aborted — fixed
    ✅ domcontentloaded + waitForTimeout(1500) — fixed
    ✅ authScreen hidden — fixed
    ✅ Signature overlay injected
    → PDF generated
    → Uploaded to signed-quotes bucket
    → createSignedUrl (7 days) ← ⚠️ EXPIRES
    → quote_signatures.pdf_url updated
    → Resend email → signer + owner + viewers
        Body: "Your signed quote is ready. Download: [link]"
```

---

## Critical Path Analysis

The customer-facing PDF journey has **5 failure points**, ordered by severity:

| # | Failure Point | Symptom | Currently Broken? |
|---|--------------|---------|-------------------|
| 1 | PDF URL expires after 7 days | Customer gets 403 on their signed document | ⚠️ Yes — all existing PDFs |
| 2 | Cold start on Cloud Run | PDF email arrives 15+ seconds late | ⚠️ Yes — every quiet period |
| 3 | pdf-generator crashes silently | Customer never receives PDF, no retry | ⚠️ Yes — no visibility |
| 4 | Resend rate limit / failure | Email not sent, no retry | ⚠️ Yes — silent |
| 5 | Black / corrupt PDF | Customer receives a broken file | ✅ Fixed this session |

---

## Decision: Fix Order by Customer Impact

### TIER 1 — Customer Loses Access to Their Document (FIX TODAY)

#### Fix 1A: Make PDF URLs Permanent
**Problem:** `createSignedUrl(filename, 7_days)` — after 7 days, the link in the signer's email returns 403. This is a legal document they need to keep. It affects **every PDF already generated**.

**Decision:** Switch `signed-quotes` bucket to public access. The filename is `{quote_id}-{signature_id}.pdf` — a UUID4 + quote ID — not enumerable in practice. Public bucket + non-guessable filename = sufficient security at this volume.

**File to change:** `pdf-generator/index.js`

```javascript
// REMOVE:
const { data: urlData, error: urlError } = await supabase.storage
  .from(STORAGE_BUCKET)
  .createSignedUrl(filename, SIGNED_URL_EXPIRY_SECS);
if (urlError) throw new Error(`Signed URL failed: ${urlError.message}`);
const pdfUrl = urlData.signedUrl;

// REPLACE WITH:
const { data: { publicUrl: pdfUrl } } = supabase.storage
  .from(STORAGE_BUCKET)
  .getPublicUrl(filename);
```

**Supabase dashboard:** Set `signed-quotes` bucket → Public.

**Backfill existing PDFs:** Run this once to regenerate public URLs for all existing records:
```sql
-- After making bucket public, public URL format is:
-- https://tjitewgiszukqyjujxrh.supabase.co/storage/v1/object/public/signed-quotes/{filename}
-- Extract filename from current signed URLs and reconstruct public URL
UPDATE quote_signatures
SET pdf_url = CONCAT(
  'https://tjitewgiszukqyjujxrh.supabase.co/storage/v1/object/public/signed-quotes/',
  REGEXP_REPLACE(pdf_url, '^.*signed-quotes/([^?]+).*$', '\1')
)
WHERE pdf_url IS NOT NULL AND pdf_url LIKE '%/token=%';
```

**Effort:** 30 minutes. **Risk:** None — public URL is simpler and more reliable.

---

#### Fix 1B: Eliminate Cold Start
**Problem:** Cloud Run scales to zero. First request after ~15 minutes idle = 8–15 second boot time before Playwright even starts. The PDF email arrives very late.

**Decision:** Set `min-instances=1`. At 10 quotes/month, cost is ~$5–8/month (one always-warm Cloud Run instance).

```bash
gcloud run services update pdf-generator \
  --min-instances=1 \
  --region=europe-west1 \
  --project=quota-gen
```

**Effort:** 2 minutes. **Cost:** ~$6/month. **Customer impact:** Immediate — PDF email arrives in seconds, not minutes.

---

### TIER 2 — Silent Failure (Customer Never Gets PDF)

#### Fix 2A: Add Failure Visibility to pdf-generator
**Problem:** `sign-quote` calls pdf-generator fire-and-forget (`.catch(console.error)`). If pdf-generator is down, returns 500, or generates a corrupt PDF — **the signer gets a 200 OK confirmation but never receives the PDF**. There is no alert, no retry, no indication anything went wrong.

**Decision:** Two-layer fix:

**Layer 1 — Admin alert on pdf-generator failure** (10 minutes):
Add to `sign-quote/index.ts` — if the pdf-generator call returns non-2xx, send admin alert:

```typescript
// Replace current fire-and-forget with tracked call
fetch(PDF_GENERATOR_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json", "Authorization": `Bearer ${PDF_GENERATOR_SECRET}` },
  body: JSON.stringify({ ... }),
}).then(async (r) => {
  if (!r.ok) {
    const errText = await r.text().catch(() => 'unknown');
    console.error(`[PDF FAIL] ${quote_id}: HTTP ${r.status} — ${errText}`);
    // Send admin alert via Resend
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "CargoNex Alerts <hello@cargonex.io>",
        to: [ADMIN_EMAIL],
        subject: `🚨 PDF נכשל — ${quote_id}`,
        html: `<p>PDF generation failed for <strong>${quote_id}</strong>.<br/>Signer: ${signer_email}<br/>HTTP: ${r.status}</p>`,
      }),
    }).catch(() => {});
  }
}).catch((e) => {
  console.error(`[PDF CALL FAIL] ${quote_id}:`, e.message);
  // Same admin alert
});
```

**Layer 2 — UptimeRobot health check** (10 minutes, free):
1. Go to uptimerobot.com → Add Monitor
2. Type: HTTP(s), URL: `https://pdf-generator-641138828646.europe-west1.run.app/health`
3. Check interval: 5 minutes
4. Alert: email to `dror@cargonex.io`

If Cloud Run goes down — you know in 5 minutes, not when a client complains.

---

#### Fix 2B: Add `RESEND_API_KEY` Validation on pdf-generator Startup
**Problem:** If `RESEND_API_KEY` is missing or wrong, Playwright generates the PDF successfully but the email silently fails. Customer never receives their document.

Add to `pdf-generator/index.js` startup:
```javascript
if (!RESEND_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY || !PDF_GENERATOR_SECRET) {
  console.error("[STARTUP] Missing required env vars. Refusing to start.");
  process.exit(1);
}
```

**Effort:** 5 minutes. **Prevents:** Zombie deployments that appear healthy but can't deliver PDFs.

---

### TIER 3 — Reliability Hardening

#### Fix 3A: Remove `ws` Import from pdf-generator
**File:** `pdf-generator/index.js`
```javascript
// Remove line 4:
import ws from "ws";

// Remove from Supabase client:
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
// (remove the realtime: { transport: ws } option)
```
Docker image becomes ~500KB smaller. Cold start (when it does happen) is slightly faster.

#### Fix 3B: `page.waitForFunction()` Instead of Fixed Timeout
**File:** `pdf-generator/index.js`
```javascript
// Replace: await page.waitForTimeout(1500);
// With:
await page.waitForFunction(() => document.fonts.ready, { timeout: 5000 })
  .catch(() => {}); // fallback if fonts don't load — continue anyway
```
PDFs where fonts load fast (cached CDN) generate in 200ms instead of 1,500ms.

---

## Working Plan — Execution Order

### Day 1 (Today) — Customer Can Always Access Their Document

| Step | Action | File / Location | Time |
|------|--------|----------------|------|
| 1 | Make `signed-quotes` bucket public in Supabase dashboard | Dashboard → Storage | 2 min |
| 2 | Update `pdf-generator/index.js` — swap `createSignedUrl` for `getPublicUrl` | pdf-generator | 10 min |
| 3 | Run backfill SQL to fix existing PDF URLs | Supabase SQL editor | 5 min |
| 4 | Build + deploy pdf-generator to Cloud Run | `gcloud builds submit` | 15 min |
| 5 | Set Cloud Run `min-instances=1` | `gcloud run services update` | 2 min |
| 6 | Set UptimeRobot monitor on `/health` | uptimerobot.com | 10 min |

**Total: ~45 minutes. Result: All existing + future PDFs permanently accessible. No more cold starts.**

---

### Day 2 — Silent Failure Becomes Visible

| Step | Action | File / Location | Time |
|------|--------|----------------|------|
| 7 | Add failure tracking + admin alert in sign-quote | `sign-quote/index.ts` | 20 min |
| 8 | Add startup env var validation in pdf-generator | `pdf-generator/index.js` | 5 min |
| 9 | Remove `ws` import | `pdf-generator/index.js` | 5 min |
| 10 | Replace `waitForTimeout` with `waitForFunction` | `pdf-generator/index.js` | 10 min |
| 11 | Deploy sign-quote + pdf-generator | supabase + gcloud | 15 min |
| 12 | `supabase secrets set ADMIN_EMAIL=dror@cargonex.io` | CLI | 1 min |

**Total: ~55 minutes. Result: Any PDF failure immediately triggers admin email. No more silent drops.**

---

### Day 3 — End-to-End Test

Run the full E2E flow and verify:

```
[ ] Open generator.html from localhost (npx serve .)
[ ] Fill in: quote ID, client name, signer name + email (use your own)
[ ] Fill in senderEmail = dror@cargonex.io
[ ] Click "Preview" — verify modal opens with correct content
[ ] Click "Download PDF" — verify PDF looks correct (not black, Hebrew fonts render)
[ ] Click "Confirm & Send" — verify success alert with URL
[ ] Open the URL (quotes.cargonex.io/quote-XXX.html?t=TOKEN) in incognito
[ ] Verify auth screen appears and fades → content visible
[ ] Draw signature + agree checkbox + submit
[ ] Verify confirmation screen appears
[ ] Wait 15–30 seconds → check email (signer email) for PDF link
[ ] Click PDF link — verify PDF opens correctly (not 403)
[ ] After 8+ days — click same PDF link again — verify still works (permanent URL)
[ ] Check admin email (dror@cargonex.io) — verify "quote opened" + "quote signed" notifications
```

---

## Architecture Diagram — Target State (After Fixes)

```
Admin fills generator.html
    ↓ "Confirm & Send"
    → upload-quote (Edge Function) [--no-verify-jwt]
        → quotes-html bucket (HTML stored permanently)
        → quotes table (metadata + html_content for PDF render)
        → send-quote-links (Edge Function) [async, fire-and-forget]
            → Creates signer token (30 days)
            → Creates viewer tokens (30 days)
            → Resend email to signer: "Your quote is ready"
            → Resend email to viewers: "You're invited to view"

Customer opens quotes.cargonex.io/quote-XXX.html?t=TOKEN
    → Cloudflare Worker
        [Phase 1] Serves HTML (client-side token check)
        [Phase 2] Server-side token validation before serving
    → quote-template-v1.html rendered in browser
        → Token validated (authScreen fades)
        → Customer reads quote
        → track-event events fire (quote_opened, section_viewed, etc.)
        → Admin notified on first open

Customer signs
    → sign-quote (Edge Function) [--no-verify-jwt]
        → Token required + validated (role + expiry)
        → Stamp uploaded to Storage (if provided)
        → quote_signatures INSERT
        → Fetch viewer emails
        → Fetch html_content from quotes table
        → POST pdf-generator/generate-pdf
            [Track response — alert admin on failure] ← NEW
        ← 200 OK to customer (instant)

pdf-generator (Cloud Run, min-instances=1) ← ALWAYS WARM
    → Route blocking (no analytics calls)
    → domcontentloaded + fonts.ready
    → authScreen hidden
    → Signature overlay injected
    → PDF generated (A4, full fidelity, Hebrew fonts)
    → Uploaded to signed-quotes bucket (PUBLIC) ← PERMANENT URL
    → quote_signatures.pdf_url updated
    → Resend email → signer + owner + viewers
        "Your signed quote: [permanent link]"

UptimeRobot pings /health every 5 minutes ← NEW
    → Email alert if down

Admin receives:
    1. "Quote opened" email (first non-bot view)
    2. "Quote signed" email
    3. PDF delivery failure alert (if any) ← NEW
    4. Same PDF as customer
```

---

## Trade-offs Accepted

| Decision | What We Gain | What We Give Up |
|----------|-------------|-----------------|
| Public `signed-quotes` bucket | Permanent URLs, no expiry | PDF URLs technically guessable if attacker has quote_id + UUID — acceptable at 10/month |
| `min-instances=1` on Cloud Run | Zero cold start | ~$6/month always-on cost |
| Fire-and-forget PDF gen | Signer gets instant 200 OK | If PDF fails, signer already dismissed the tab — mitigated by admin alert |
| HTML stored in `quotes` DB table | Simple architecture | Large TEXT rows — acceptable at current volume, migrate in Phase 2 |

---

## What Is NOT in Scope (This Phase)

- Server-side token validation in Cloudflare Worker (Phase 2 — see TECH_DEBT TD-05)
- CI/CD pipeline (Phase 2 — TD-10)
- Quote versioning with token revocation (Phase 3 — per PRD)
- Certified e-signature (Phase 3 — per PRD)
- Quote dashboard / admin UI (Phase 3 — per PRD)

---

## Deploy Commands Reference

```bash
# After editing pdf-generator/index.js:
cd pdf-generator
gcloud builds submit --tag europe-west1-docker.pkg.dev/quota-gen/pdf-generator/pdf-generator:latest
gcloud run deploy pdf-generator \
  --image europe-west1-docker.pkg.dev/quota-gen/pdf-generator/pdf-generator:latest \
  --region europe-west1 \
  --min-instances=1

# After editing sign-quote:
supabase functions deploy sign-quote --project-ref tjitewgiszukqyjujxrh

# Set secrets:
supabase secrets set ADMIN_EMAIL=dror@cargonex.io --project-ref tjitewgiszukqyjujxrh
supabase secrets set RESEND_API_KEY=re_... --project-ref tjitewgiszukqyjujxrh
```

---

*ADR-001 — CargoNex Quote-Gen — 2026-05-30*
