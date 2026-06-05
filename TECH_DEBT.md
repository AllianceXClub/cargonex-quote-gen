# Tech Debt & Bottleneck Analysis — CargoNex Quote-Gen
**Date:** 2026-05-30
**Scope:** Full codebase — Edge Functions, pdf-generator, generator.html, quote-template-v1.html, Cloudflare Worker
**Volume baseline:** ~10 quotes/month (Phase 1)

> **Priority Score** = (Impact + Risk) × (6 − Effort)
> Scale: 1–5 per dimension. Higher score = fix sooner.

---

## Summary

At current volume (10/month), none of the debt items below will cause immediate failure. But 4 items become **active bottlenecks the moment volume grows**, and 2 items create **silent failures that are already happening today** with no visibility. The highest-ROI fix at this stage is monitoring — it costs 2 hours and immediately makes every other problem visible.

---

## Category 1 — Performance Bottlenecks 🐢

### TD-01 — Playwright Cold Start on Cloud Run
**File:** `pdf-generator/index.js` + Cloud Run config
**Description:** Cloud Run scales to zero when idle. Playwright + Chromium takes 8–15 seconds to boot from cold. A quote signed after the service has been idle for 20+ minutes will have a 15-second delay before PDF generation starts — invisible to the signer (fire-and-forget), but the PDF email arrives late.

| Impact | Risk | Effort | **Score** |
|--------|------|--------|-----------|
| 4 | 3 | 2 | **28** |

**Fix:** Set `min-instances=1` on Cloud Run (keeps one warm instance alive — ~$5–8/month at current volume). Alternatively, add a `/health` ping from a cron job every 5 minutes.
```bash
gcloud run services update pdf-generator \
  --min-instances=1 \
  --region=europe-west1
```

---

### TD-02 — `html_content` TEXT Column in `quotes` Table
**File:** `supabase/functions/upload-quote/index.ts`, DB schema
**Description:** Each quote's full HTML (50–500KB) is stored as a TEXT column in the `quotes` table. Every `SELECT html_content` in `sign-quote` loads the full HTML into memory. At 10 quotes, no impact. At 1,000 quotes, each sign operation does a 200KB DB read from a row that also includes all other metadata. No pagination, no archiving.

Additionally, the Supabase dashboard's table view becomes unusable when scrolling through large TEXT columns.

| Impact | Risk | Effort | **Score** |
|--------|------|--------|-----------|
| 3 | 2 | 3 | **15** |

**Fix:** Store HTML in Supabase Storage (it already is — in `quotes-html` bucket). Change the `quotes` table to store only a `storage_path` reference, and have `sign-quote` fetch from Storage instead of DB. Remove `html_content` column after migration.
```sql
ALTER TABLE quotes ADD COLUMN storage_path TEXT;
-- Backfill: storage_path = filename
-- Then: DROP COLUMN html_content (after verifying sign-quote uses storage)
```

---

### TD-03 — Sequential Token Creation in `send-quote-links`
**File:** `supabase/functions/send-quote-links/index.ts`
**Description:** Viewer tokens and emails are created in a `for` loop — one by one, awaiting each DB insert + email send before moving to the next. With 5 viewers, this adds 5 × (DB round trip + Resend API call) ≈ 5–10 seconds to quote delivery.

```typescript
// Current — sequential
for (const viewer of viewers) {
  const link = await createTokenLink(...);  // DB insert
  viewerLinks.push(link);
}
for (let i = 0; i < viewers.length; i++) {
  await sendEmail(viewers[i].email, ...);   // Resend API
}
```

| Impact | Risk | Effort | **Score** |
|--------|------|--------|-----------|
| 2 | 1 | 2 | **15** |

**Fix:** Run all token creates + all email sends in parallel with `Promise.all`.
```typescript
const viewerLinks = await Promise.all(
  viewers.map(v => createTokenLink(v.email, v.name || v.email, "viewer"))
);
await Promise.all(
  viewers.map((v, i) => v.email ? sendEmail(v.email, ...) : Promise.resolve())
);
```

---

### TD-04 — Fixed `waitForTimeout(1500)` in Playwright
**File:** `pdf-generator/index.js` (both `/preview-pdf` and `/generate-pdf` PATH A)
**Description:** After `setContent()`, the code waits a fixed 1,500ms for fonts/rendering. This is a hardcoded delay. If fonts load in 200ms, we wait 1.3 seconds for nothing. If Google Fonts is slow (CDN timeout), 1.5 seconds isn't enough and the font falls back to Arial.

| Impact | Risk | Effort | **Score** |
|--------|------|--------|-----------|
| 2 | 2 | 3 | **12** |

**Fix (short-term):** Increase to 2,500ms and add font preload in the template. **Fix (proper):** Use `page.waitForFunction()` to detect when Heebo font has loaded:
```javascript
await page.waitForFunction(() => document.fonts.ready, { timeout: 5000 });
```

---

## Category 2 — Architecture Debt 🏗

### TD-05 — No Server-Side Token Validation at Cloudflare Worker
**File:** `quotes/worker.js`
**Description:** The Cloudflare Worker serves the full quote HTML from Supabase Storage without checking the `?t=` token. All token validation is in the browser (`initAuth()` in quote-template-v1.html). Anyone who knows the quote filename (`quote-CN-QUO-2026-001.html`) can fetch the HTML directly — bypassing auth entirely. Competitor enumerating `quote-CN-QUO-2026-*.html` gets all quotes.

| Impact | Risk | Effort | **Score** |
|--------|------|--------|-----------|
| 5 | 4 | 3 | **27** |

**Fix:** Add token validation in `worker.js` before serving HTML. Call Supabase `quote_tokens` table server-side using the service key:
```javascript
// In worker.js fetch handler
const token = url.searchParams.get('t');
if (!token) return new Response('Unauthorized', { status: 401 });

const res = await fetch(`${env.SUPABASE_URL}/rest/v1/quote_tokens?token=eq.${token}&select=role,expires_at`, {
  headers: { 'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'apikey': env.SUPABASE_SERVICE_KEY }
});
const rows = await res.json();
if (!rows.length || new Date(rows[0].expires_at) < new Date()) {
  return new Response('Link invalid or expired', { status: 403 });
}
// then serve HTML
```

---

### TD-06 — Dual `generator.html` Files (Root vs `quotes/`)
**File:** `generator.html` (root), `quotes/generator.html`
**Description:** There are two versions of the generator. The root `generator.html` is the live one being edited. `quotes/generator.html` appears to be an older copy. Any change to the root doesn't propagate. If someone deploys from the `quotes/` folder, they're deploying stale code.

```
Quote-Gen/
├── generator.html          ← live (1,423 lines, up to date)
└── quotes/
    └── generator.html      ← stale copy (different line count)
```

| Impact | Risk | Effort | **Score** |
|--------|------|--------|-----------|
| 3 | 4 | 1 | **35** |

**Fix:** Delete `quotes/generator.html`. The root version is canonical. The Cloudflare Worker's `wrangler.toml` has `[assets] directory = "./"` which serves from the quotes folder — update the Cloudflare deploy to pull from the root `generator.html`.

---

### TD-07 — Edge Functions Have No Shared Constants Layer
**File:** All 5 Edge Functions
**Description:** `FROM_EMAIL`, Supabase project URLs, bucket names (`quotes-html`, `signature-stamps`, `signed-quotes`), and the `send-quote-links` URL are scattered across files as magic strings. Renaming a bucket or changing a domain requires hunting through all functions.

| Impact | Risk | Effort | **Score** |
|--------|------|--------|-----------|
| 2 | 3 | 2 | **20** |

**Fix:** Create a shared `_shared/constants.ts` in the Edge Functions folder (Supabase supports shared imports):
```typescript
// supabase/functions/_shared/constants.ts
export const BUCKET_QUOTES_HTML = "quotes-html";
export const BUCKET_STAMPS = "signature-stamps";
export const BUCKET_SIGNED = "signed-quotes";
export const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "CargoNex <hello@cargonex.io>";
```

---

### TD-08 — `pdf-generator` Is a Single 300-Line Monolith
**File:** `pdf-generator/index.js`
**Description:** `index.js` mixes Express routing, Playwright logic, Supabase storage operations, email sending, and HTML template building (`buildSignedPdfHtml`, `buildEmailHtml`) in one file. Adding a new PDF type or email template requires modifying the same file that controls browser lifecycle.

| Impact | Risk | Effort | **Score** |
|--------|------|--------|-----------|
| 2 | 2 | 3 | **12** |

**Fix (Phase 2):** Split into `routes/`, `services/playwright.js`, `services/email.js`, `templates/`. Not urgent at current volume.

---

## Category 3 — Infrastructure Debt 🔧

### TD-09 — Zero Monitoring and Alerting
**Files:** All
**Description:** There is no visibility into the system's health. If pdf-generator crashes, sign-quote returns 200 but PDF never arrives — **the signer thinks it worked**. If Resend is down, emails are silently dropped. If Supabase is down, uploads silently fail. No Sentry, no Datadog, no Cloud Run error alerts, no Uptime check.

This is the highest-risk item because **failures are already invisible today**.

| Impact | Risk | Effort | **Score** |
|--------|------|--------|-----------|
| 5 | 5 | 2 | **40** |

**Fix (2 hours):**
1. Google Cloud Run → enable "Error reporting" (already built-in, just needs a notification channel)
2. Add Sentry to `pdf-generator/index.js` — 3 lines:
```javascript
import * as Sentry from "@sentry/node";
Sentry.init({ dsn: process.env.SENTRY_DSN });
app.use(Sentry.Handlers.requestHandler());
```
3. Add a UptimeRobot (free) monitor on `https://pdf-generator.../health` with email alert
4. Supabase → Dashboard → Logs → set alert on Edge Function 5xx rate

---

### TD-10 — No CI/CD Pipeline
**Description:** Every deployment is a manual `supabase functions deploy` + `gcloud builds submit` command. No automation, no validation before deploy, no rollback mechanism. A typo in a function breaks production with no safeguard.

| Impact | Risk | Effort | **Score** |
|--------|------|--------|-----------|
| 4 | 4 | 3 | **24** |

**Fix:** Add a GitHub Actions workflow:
```yaml
# .github/workflows/deploy.yml
on:
  push:
    branches: [main]
jobs:
  deploy-functions:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: supabase/setup-cli@v1
      - run: supabase functions deploy sign-quote --project-ref tjitewgiszukqyjujxrh
      - run: supabase functions deploy upload-quote --project-ref tjitewgiszukqyjujxrh
        # ... etc
```

---

### TD-11 — Signed PDF URLs Expire in 7 Days, No Renewal
**Files:** `pdf-generator/index.js`, `supabase/functions/sign-quote/index.ts`
**Description:** Signed PDF URLs stored in `quote_signatures.pdf_url` expire after 7 days. After that, clients clicking the link in their email get a 403. The signature record remains in the DB, but the PDF is inaccessible. No renewal flow exists.

For a system storing legally binding documents for 7 years (per PRD), this is a design conflict.

| Impact | Risk | Effort | **Score** |
|--------|------|--------|-----------|
| 4 | 4 | 2 | **32** |

**Fix:** Change `signed-quotes` bucket to **public** (files are UUIDs + quote_id — not guessable) or use a long-lived signed URL (Supabase max = 1 year). For legal documents, store a **permanent public URL** and rely on the UUID-based filename for obscurity:
```javascript
// Instead of createSignedUrl:
const { data: { publicUrl } } = supabase.storage
  .from(STORAGE_BUCKET)
  .getPublicUrl(filename);
```

---

### TD-12 — `quote_tokens` Table Never Pruned
**File:** `supabase/functions/send-quote-links/index.ts`, DB
**Description:** Every time a quote is sent (or re-sent), new token rows are created. Expired tokens are never deleted. The table grows indefinitely. Old tokens can't be signed (expiry check blocks it), but they accumulate.

| Impact | Risk | Effort | **Score** |
|--------|------|--------|-----------|
| 1 | 2 | 1 | **15** |

**Fix:** Add a Supabase cron job (pg_cron):
```sql
SELECT cron.schedule(
  'prune-expired-tokens',
  '0 3 * * *',  -- 3am daily
  $$ DELETE FROM quote_tokens WHERE expires_at < NOW() $$
);
```

---

## Category 4 — Test Debt 🧪

### TD-13 — Zero Automated Tests
**Files:** All
**Description:** There are no unit tests, integration tests, or E2E tests. Every change is validated manually by running through the full flow. A regression in `buildQuoteHTML()` in `generator.html` (1,400+ lines of string concatenation) will only be caught when a real quote looks wrong.

| Impact | Risk | Effort | **Score** |
|--------|------|--------|-----------|
| 5 | 5 | 4 | **20** |

**Minimum viable test plan:**
1. **Unit test for `buildQuoteHTML()`** — verify required placeholders are replaced. Pure JS, runs in Node.
2. **Integration test for `sign-quote`** — POST with a test token, verify DB row created. Use Supabase test project.
3. **Smoke test for `pdf-generator`** — POST minimal HTML to `/preview-pdf`, assert response is a valid PDF (check magic bytes `%PDF`).

---

## Category 5 — Code Debt 💸

### TD-14 — Supabase Anon Key Hardcoded in Template
**File:** `quote-template-v1.html` line 1779
**Description:** (Documented in code review.) The anon key is baked into every generated quote. Changing the key requires regenerating all active quotes. Risk is bounded by RLS — but RLS must be verified as complete.

| Impact | Risk | Effort | **Score** |
|--------|------|--------|-----------|
| 3 | 4 | 3 | **21** |

**Fix (proper):** Route all calls through Edge Functions (no anon key needed client-side). The only client-side call that still uses the anon key is `track-event` — replace with a direct unauthenticated endpoint, or accept the key remains public and ensure RLS fully locks the `quote_events` table to INSERT-only via anon.

---

### TD-15 — `generator.html` Has 1,400+ Lines of Inline String Concatenation
**File:** `generator.html`
**Description:** `buildQuoteHTML()` generates the entire quote HTML via JavaScript string concatenation — including inline CSS (400+ lines), inline JS (300+ lines), and all content sections. This makes the generator brittle: a missing `'` or `+` breaks the entire quote silently. Debugging requires reading minified string output.

| Impact | Risk | Effort | **Score** |
|--------|------|--------|-----------|
| 3 | 3 | 4 | **12** |

**Fix (Phase 2):** Use a template literal approach or extract the quote template as a separate fetch. At current volume — acceptable. Track as Phase 2 item.

---

### TD-16 — `ws` Package Unused in `pdf-generator`
**File:** `pdf-generator/index.js` line 4, `package.json`
**Description:** `import ws from "ws"` is imported and passed to Supabase client as `realtime: { transport: ws }`, but no realtime subscriptions are ever opened. This adds ~500KB to the Docker image and is a misleading signal to anyone reading the code.

| Impact | Risk | Effort | **Score** |
|--------|------|--------|-----------|
| 1 | 1 | 1 | **10** |

**Fix:** Remove the import and the `realtime` option from the Supabase client constructor.

---

### TD-17 — No Input Size Limit on `html_content` in `upload-quote`
**File:** `supabase/functions/upload-quote/index.ts`
**Description:** `html_content` is accepted from the request body with no size check. Express default limit is 10MB (set in `pdf-generator`). If someone sends a malformed or oversized payload, it stores gigabytes in the DB and Storage.

| Impact | Risk | Effort | **Score** |
|--------|------|--------|-----------|
| 2 | 3 | 1 | **25** |

**Fix:**
```typescript
const MAX_HTML_BYTES = 1_000_000; // 1MB
if (html_content.length > MAX_HTML_BYTES) {
  return new Response(JSON.stringify({ error: "html_content exceeds 1MB limit" }), { status: 413, ... });
}
```

---

## Category 6 — Documentation Debt 📄

### TD-18 — No README / Deployment Runbook
**Files:** Root folder
**Description:** There is no `README.md`. A new developer (or future-you after 3 months) has no starting point. The WORKPLAN and PRD describe intent but not operational reality: how to set up locally, which env vars are required, how to deploy, how to test.

| Impact | Risk | Effort | **Score** |
|--------|------|--------|-----------|
| 3 | 3 | 1 | **30** |

**Fix:** 30-minute README covering: architecture overview, env var table, deploy commands, local testing steps. The `CODE_REVIEW.md` env var checklist is a good starting point.

---

## Prioritized Master List

| Rank | ID | Name | Score | Category | Effort |
|------|----|------|-------|----------|--------|
| 1 | TD-09 | Zero monitoring | **40** | Infrastructure | Low |
| 2 | TD-06 | Dual generator.html files | **35** | Architecture | Trivial |
| 3 | TD-11 | PDF URLs expire in 7 days | **32** | Infrastructure | Low |
| 4 | TD-01 | Playwright cold start | **28** | Performance | Low |
| 5 | TD-05 | No server-side token validation | **27** | Architecture | Medium |
| 6 | TD-17 | No html_content size limit | **25** | Code | Trivial |
| 7 | TD-10 | No CI/CD | **24** | Infrastructure | Medium |
| 8 | TD-07 | No shared constants | **20** | Architecture | Low |
| 9 | TD-14 | Anon key in template | **21** | Code | Medium |
| 10 | TD-13 | Zero tests | **20** | Testing | High |
| 11 | TD-18 | No README | **30** | Documentation | Trivial |
| 12 | TD-02 | HTML in DB | **15** | Performance | Medium |
| 13 | TD-03 | Sequential token creation | **15** | Performance | Low |
| 14 | TD-12 | Tokens never pruned | **15** | Infrastructure | Trivial |
| 15 | TD-04 | Fixed waitForTimeout | **12** | Performance | Medium |
| 16 | TD-08 | pdf-generator monolith | **12** | Architecture | High |
| 17 | TD-15 | buildQuoteHTML string concat | **12** | Code | High |
| 18 | TD-16 | Unused `ws` import | **10** | Code | Trivial |

---

## Remediation Plan

### Phase 1 — Now (< 1 day, zero risk, high visibility)
These are quick wins with no deployment risk:

| Action | ID | Time |
|--------|-----|------|
| Delete `quotes/generator.html` | TD-06 | 2 min |
| Set Cloud Run `min-instances=1` | TD-01 | 5 min |
| Add html_content size check | TD-17 | 10 min |
| Add token pruning cron (pg_cron) | TD-12 | 10 min |
| Remove `ws` import from pdf-generator | TD-16 | 5 min |
| Write README with deploy runbook | TD-18 | 30 min |
| **Set up UptimeRobot on `/health`** | TD-09 | 10 min |
| **Enable Cloud Run error alerts** | TD-09 | 10 min |

---

### Phase 2 — Next sprint (< 1 week, medium effort)
| Action | ID | Time |
|--------|-----|------|
| Add Sentry to pdf-generator | TD-09 | 1h |
| GitHub Actions deploy pipeline | TD-10 | 2h |
| Server-side token validation in Worker | TD-05 | 2h |
| Change PDF URLs to public/long-lived | TD-11 | 1h |
| Add shared `_shared/constants.ts` | TD-07 | 1h |
| Parallelize token creation in send-quote-links | TD-03 | 30 min |

---

### Phase 3 — Backlog (pre-Phase 3 of PRD)
| Action | ID | Notes |
|--------|-----|-------|
| Move html_content to Storage-only | TD-02 | Needs migration |
| Add minimum test suite | TD-13 | 1 day |
| Fix font wait strategy | TD-04 | After tests |
| Route all template calls through Edge Functions (remove anon key) | TD-14 | Bigger refactor |
| Split pdf-generator into modules | TD-08 | Low urgency |

---

## Current Bottleneck at Scale

**Today (10 quotes/month):** No operational bottleneck. Cold start is the only noticeable friction.

**At 50 quotes/month:** TD-01 (cold start) becomes a daily annoyance. TD-03 (sequential tokens) adds seconds to every send. TD-11 (PDF URL expiry) starts causing support requests ("my PDF link doesn't work anymore").

**At 200 quotes/month:** TD-02 (HTML in DB) causes slow sign-quote responses. TD-05 (no server-side auth) becomes a real exposure risk as more URLs circulate. TD-09 (no monitoring) means incidents are found by clients, not by you.

**At 1,000 quotes/month:** TD-08 (pdf-generator monolith) needs splitting to scale PDF workers independently. TD-13 (no tests) means every deploy is a gamble.

---

*Analysis by Claude Sonnet 4.6 — 2026-05-30*
