# Code Review — CargoNex Quote-Gen
**Date:** 2026-05-30
**Reviewer:** Claude (Sonnet 4.6)
**Scope:** Full codebase — all Edge Functions, pdf-generator, generator.html, quote-template-v1.html, Cloudflare Worker
**Verdict:** 🔴 Request Changes — 5 critical issues must be resolved before production use

---

## Summary

The system architecture is sound and well-thought-out. The flow from generator → upload → Cloudflare Worker → signer → sign-quote → pdf-generator is clean, and recent fixes addressed several legitimate bugs. However, 5 critical issues remain that will cause silent failures or security exposure in production. The most severe: `sign-quote/index.ts` is **truncated mid-function**, meaning PDF generation never triggers after signing.

---

## Critical Issues 🔴

| # | File | Line | Issue | Severity |
|---|------|------|-------|----------|
| 1 | `supabase/functions/sign-quote/index.ts` | 118 | **File truncated — pdf-generator call missing** | 🔴 Critical |
| 2 | `pdf-generator/index.js` | 84 | **`/generate-pdf` PATH A uses `networkidle` without route blocking** | 🔴 Critical |
| 3 | `supabase/functions/sign-quote/index.ts` | 37 | **Token validation is optional — any caller can skip it** | 🔴 Critical |
| 4 | `quote-template-v1.html` | 1779 | **Supabase Anon Key hardcoded in every generated quote file** | 🔴 Critical |
| 5 | `quotes/wrangler.toml` | 3 | **Cloudflare `account_id` committed to git** | 🔴 Critical |

---

### 1. `sign-quote/index.ts` — File Truncated at Line 118

The file ends mid-comment on line 118:
```typescript
// Fetch full HTML from quotes table (for full PDF render)
```

The code that fetches `quote_html` from the `quotes` table, builds the pdf-generator payload, fires the `fetch()` to Cloud Run, and returns the HTTP response to the client — **is entirely missing**. As deployed, `sign-quote` writes to DB and then returns `undefined`, which Deno serves as an empty 200 or crashes. PDF is never generated. Signer gets no confirmation.

**Fix:** Append the missing block:
```typescript
    // Fetch full HTML from quotes table (for full PDF render)
    const { data: quoteRow } = await supabase
      .from("quotes")
      .select("html_content")
      .eq("quote_id", quote_id)
      .single();

    const quote_html = quoteRow?.html_content || null;

    // Trigger PDF generation (fire-and-forget — don't block response)
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
        client_name,
        signed_at: signedAt,
        setup_fee,
        monthly_fee,
        signature_b64,
        stamp_image_url: stampUrl,
        owner_email: owner_email || "",
        viewer_emails: viewerEmails,
        quote_html,
      }),
    }).catch((e) => console.error("pdf-generator call failed:", e));

    return new Response(JSON.stringify({ ok: true, signature_id: sigId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("sign-quote error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
```

---

### 2. `pdf-generator/index.js` — `/generate-pdf` PATH A Still Uses `networkidle`

The fix (route blocking + `domcontentloaded` + `waitForTimeout`) was applied **only to `/preview-pdf`** (lines 193–206). PATH A of `/generate-pdf` (line 84) still uses:
```javascript
await page.setContent(quote_html, { waitUntil: "networkidle" });
```

The quote HTML contains `track-event` analytics calls that fire on page load. In a headless Playwright context without a valid session, these calls never resolve → `networkidle` never fires → Playwright times out → PDF is black or never generated. This is the identical root cause that was fixed for preview but not for the actual signed PDF.

**Fix:** Apply the same pattern used in `/preview-pdf` to PATH A:
```javascript
// Block analytics before setContent
await page.route('**/*', (route) => {
  const url = route.request().url();
  if (url.includes('supabase.co/functions') || url.includes('track-event') || url.includes('analytics')) {
    route.abort();
  } else {
    route.continue();
  }
});

await page.setContent(quote_html, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(1500);

// Then: evaluate() to inject signature overlay + hide authScreen
```

---

### 3. `sign-quote/index.ts` — Token Validation Is Optional

```typescript
if (token) {          // ← only validates IF token is provided
  const { data: tokenRow } = await supabase
    .from("quote_tokens")
    ...
```

If a caller omits the `token` field from the request body, validation is skipped entirely. Any actor who knows a `quote_id` (which follows a predictable pattern like `CN-QUO-2026-001`) can sign any quote without a valid token.

**Fix:** Make token required:
```typescript
if (!token) {
  return new Response(JSON.stringify({ error: "Missing token" }), {
    status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
// Then validate unconditionally
const { data: tokenRow } = await supabase
  .from("quote_tokens")
  .select("role, expires_at")
  .eq("token", token)
  .eq("quote_id", quote_id)
  .single();

if (!tokenRow) {
  return new Response(JSON.stringify({ error: "Invalid token" }), {
    status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
```

---

### 4. `quote-template-v1.html` — Supabase Anon Key Hardcoded in Every Quote

```javascript
// line 1779
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
```

This key is embedded directly in the HTML template and therefore **baked into every generated quote file** that is uploaded to Supabase Storage and served publicly via Cloudflare. Any recipient of a quote can extract this key from view-source and use it to call any Supabase Edge Function or query the database directly via the Supabase REST API.

**Risk level:** The anon key is scoped to the anon role, so Row Level Security (RLS) limits damage — but only if RLS is fully configured on all tables. If any table has `RLS disabled` or an overly permissive policy, this key grants read/write access.

**Fix (short-term):** This is unavoidable for client-side Supabase calls. Ensure RLS is enabled and locked down on `quotes`, `quote_signatures`, `quote_tokens`, and `quote_events`. The anon role should have **zero direct table access** — all operations must go through Edge Functions (which use the service key server-side).

**Fix (long-term):** Replace direct Supabase calls from the template with calls to your own Edge Functions, which don't require the anon key.

---

### 5. `quotes/wrangler.toml` — Cloudflare `account_id` in Git

```toml
account_id = "584833359c809320317e6074a73af8ad"
```

The Cloudflare account ID is committed to the repository. While not a secret in the same class as an API key, it narrows the attack surface significantly for social engineering and API abuse. It should not be in source control.

**Fix:** Remove from `wrangler.toml`, use environment variable or Wrangler's `--account-id` CLI flag.

---

## High Severity Issues 🟠

| # | File | Issue |
|---|------|-------|
| 6 | `upload-quote/index.ts` | `owner_email` not passed to `send-quote-links` — contact email in signer emails comes from env var only |
| 7 | `pdf-generator/index.js` | No Playwright browser timeout guard — hung sessions leak browser processes |
| 8 | `pdf-generator/index.js` | PATH B also uses `waitUntil: "networkidle"` — same black PDF risk |
| 9 | `upload-quote/index.ts` | No input size validation on `html_content` — malformed or oversized payloads crash the function |
| 10 | `send-quote-links/index.ts` | No deduplication — calling `upload-quote` twice for the same `quote_id` creates duplicate tokens and sends duplicate emails |
| 11 | `sign-quote/index.ts` | No protection against double submission — browser back + re-submit creates a second signature record |

### Issue 6 — owner_email Chain Broken

`generator.html` collects `senderEmail` from the form and embeds it in the generated quote HTML. But the `confirmAndSend()` call to `upload-quote` does **not** include `owner_email`:

```javascript
// generator.html — confirmAndSend()
body: JSON.stringify({
  quote_id: p.quoteId,
  filename: p.filename,
  html_content: p.html,
  signer: { name: p.signerName, email: p.signerEmail },
  viewers: p.viewers || [],
  base_url: p.baseUrl
  // ← owner_email missing
})
```

`upload-quote` then calls `send-quote-links` also without `owner_email`. The signer email footer shows `owner_email` as `Deno.env.get("ADMIN_EMAIL")` — a global env var, not per-quote.

**Fix:** Add `owner_email: p.ownerEmail` to the `confirmAndSend` payload, accept it in `upload-quote`, and forward it to `send-quote-links`.

### Issue 7 — Playwright Browser Leak

```javascript
let browser;
try {
  browser = await chromium.launch({...});
  // ... long operations
} catch (err) {
  if (browser) await browser.close().catch(() => {});
  res.status(500).json({ error: err.message });
}
```

There is no overall request timeout. If `page.setContent()` or `page.pdf()` hangs indefinitely (e.g., due to a font CDN being unreachable), the browser process stays alive forever. Under load, this causes OOM on the Cloud Run instance.

**Fix:** Wrap the entire Playwright section in a `Promise.race()` with a 45-second timeout, then `browser.close()` on timeout.

### Issue 11 — Double-Signature Race Condition

The `quote_signatures` table has an intended `UNIQUE(quote_id, signer_email)` constraint per the WORKPLAN. If this constraint is not yet applied in production, double-clicking "חותם" creates two signature rows and triggers two PDF emails.

**Fix (DB):**
```sql
ALTER TABLE quote_signatures
  ADD CONSTRAINT unique_signer_per_quote
  UNIQUE (quote_id, signer_email);
```
**Fix (UX):** Disable the submit button on first click (already in template — verify this runs before the async call, not after).

---

## Medium Severity Issues 🟡

| # | File | Issue |
|---|------|-------|
| 12 | `quote-template-v1.html` | Auth screen token validation is client-side only — HTML is already served |
| 13 | `supabase/functions/track-event/index.ts` | Bot detection happens **after** the event is already inserted |
| 14 | `supabase/functions/sign-quote/index.ts` | 7-year stamp signed URLs will break if bucket is renamed or migrated |
| 15 | `quote-template-v1.html` | `{{EXPIRY_DATE_ISO}}` placeholder — if generator fails to replace it, `new Date('{{EXPIRY_DATE_ISO}}')` returns `NaN`, causing countdown to show garbage |
| 16 | `supabase/functions/upload-quote/index.ts` | `SEND_QUOTE_LINKS_URL` env var not validated on startup — runtime panic if missing |
| 17 | `pdf-generator/index.js` | Stamp image injected via string interpolation into `innerHTML` — if `stamp_image_url` contains `"` or `>`, XSS in PDF context |

### Issue 12 — Client-Side-Only Token Validation

The auth screen in `quote-template-v1.html` runs `initAuth()` in JavaScript after the page loads. The content (pricing, terms, client data) is **already in the DOM** before the auth check runs. Anyone can:
1. Open the quote URL
2. Call `document.getElementById('authScreen').style.display = 'none'`
3. Read the full quote

True protection requires server-side validation. The Cloudflare Worker currently serves HTML **directly** from Storage without checking the token. Token validation only happens in `sign-quote` — not on page load.

**Fix:** Move token validation to the Cloudflare Worker:
```javascript
// worker.js — before serving HTML
const token = url.searchParams.get('t');
if (!token) return new Response('Unauthorized', { status: 401 });

// Validate token against Supabase quote_tokens table
const valid = await validateToken(token, filename, env);
if (!valid) return new Response('Invalid or expired link', { status: 403 });
```

### Issue 13 — Bot Detection After Insert

```typescript
// track-event/index.ts — after DB insert:
if (event === "quote_opened") {
  const ua = (user_agent || "").toLowerCase();
  const BOT_UA = ["whatsapp","telegram",...];
  const isBot = BOT_UA.some(b => ua.includes(b));
  if (isBot) {
    // retroactive update — event already counted
  }
}
```

The `quote_opened` count check (`count === 1` → first open notification) already ran before the bot check. WhatsApp link preview will trigger a first-open admin notification.

**Fix:** Run bot detection **before** inserting, and set `is_bot: true` in the initial insert metadata if detected.

### Issue 17 — Stamp URL String Interpolation (XSS-Adjacent)

```javascript
// pdf-generator/index.js
${stamp_image_url ? `<img src="${stamp_image_url}" style="..."/>` : ''}
```

`stamp_image_url` is a Supabase signed URL — in practice safe. But it's injected via template literal into `innerHTML` set via `page.evaluate()`. If the URL ever contains `"` characters (e.g., from a misconfigured signed URL), it breaks the HTML attribute. Encode it:
```javascript
const safeStampUrl = stamp_image_url ? stamp_image_url.replace(/"/g, '%22') : null;
```

---

## Low Severity / Style 🟢

| # | File | Issue |
|---|------|-------|
| 18 | `pdf-generator/index.js` | `import ws from "ws"` — imported but only used for Supabase realtime client init; realtime is never subscribed to. Dead dependency adds ~500KB to Docker image. |
| 19 | `quotes/quote-324.html`, `quotes/quote-8.html` | Old test files with hardcoded client data committed to git. Should be in `.gitignore`. |
| 20 | `supabase/functions/` | `FROM_EMAIL` hardcoded as `"CargoNex <hello@cargonex.io>"` in 3 functions — should be a shared env var for easy domain changes. |
| 21 | `supabase/functions/sign-quote/index.ts` | `Uint8Array.from(atob(base64Data), c => c.charCodeAt(0))` — correct but verbose. Deno has `Deno.core.decode()`. Minor. |
| 22 | `supabase/functions/` | No TypeScript strict mode — `any` types scattered throughout. Add `// @ts-strict` where possible. |
| 23 | `pdf-generator/index.js` | No structured logging — `console.log` strings make log parsing difficult. Use `JSON.stringify({ level, quote_id, msg })`. |
| 24 | `quotes/wrangler.toml` | `run_worker_first = false` — means Worker runs after static assets. If a quote filename matches a static asset, the asset wins. Verify this is intentional. |

---

## What Looks Good ✅

- **stampUrl before INSERT** — Correctly fixed. The stamp upload happens before the DB write, so `stamp_image_url` is never null in the record when it should have a value.
- **pdf-proxy pattern** — Keeping `PDF_GENERATOR_SECRET` server-side via the Edge Function proxy is the right call. The anon key in the template only reaches the Edge Function, not Cloud Run directly.
- **Viewer/signer role enforcement** — `sign-quote` correctly rejects viewer tokens. Clean.
- **fire-and-forget pdf-generator call** — Returning 200 to the signer immediately while PDF generates async is correct UX. The signer shouldn't wait 10 seconds.
- **`/preview-pdf` fix** — `domcontentloaded` + route blocking + `waitForTimeout(1500)` is the right fix for the preview path.
- **`send-quote-links` token design** — 30-day expiry, role-scoped tokens, UUID v4 entropy. Solid for current volume.
- **ADMIN_EMAIL env var** — Correctly removed hardcoded emails from `track-event` and `send-quote-links`.
- **Immutable signature records** — INSERT-only on `quote_signatures` is the right call for a legally compliant audit trail.
- **Expiry state UI** — Full handling of expired quotes with disabled CTA and contact info. Correct per PRD.
- **Analytics retry logic** — Client-side retry with exponential backoff in `quote-template-v1.html` is well-implemented.
- **Confetti** — Nice touch. 🎉

---

## Action Plan — Ordered by Priority

| Priority | Action | File | Effort |
|----------|--------|------|--------|
| 🔴 P0 | Complete `sign-quote/index.ts` (append missing 20 lines) | sign-quote | 15 min |
| 🔴 P0 | Add route blocking + domcontentloaded to `/generate-pdf` PATH A | pdf-generator | 20 min |
| 🔴 P0 | Make `token` required in `sign-quote` | sign-quote | 10 min |
| 🔴 P0 | Verify RLS is locked down on all tables (anon = no direct access) | Supabase Dashboard | 30 min |
| 🔴 P0 | Remove `account_id` from `wrangler.toml` | wrangler.toml | 5 min |
| 🟠 P1 | Pass `owner_email` through generator → upload-quote → send-quote-links | 3 files | 30 min |
| 🟠 P1 | Add Playwright timeout guard (45s) in pdf-generator | pdf-generator | 20 min |
| 🟠 P1 | Apply UNIQUE constraint on `quote_signatures(quote_id, signer_email)` | Supabase migration | 10 min |
| 🟡 P2 | Move token validation to Cloudflare Worker (server-side) | worker.js | 60 min |
| 🟡 P2 | Fix bot detection order in `track-event` | track-event | 15 min |
| 🟡 P2 | Validate `SEND_QUOTE_LINKS_URL` env var on startup | upload-quote | 5 min |
| 🟢 P3 | Remove `ws` import from pdf-generator | pdf-generator | 5 min |
| 🟢 P3 | Add quote files to `.gitignore` | .gitignore | 5 min |
| 🟢 P3 | Move `FROM_EMAIL` to env var across all functions | 3 functions | 15 min |

**Total estimated effort:** ~4.5 hours for P0+P1. P2+P3 can be a separate session.

---

## Environment Variables Checklist

Verify all secrets are set before the next E2E test:

```bash
# Supabase Edge Functions
supabase secrets set SUPABASE_URL=https://tjitewgiszukqyjujxrh.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...
supabase secrets set PDF_GENERATOR_URL=https://pdf-generator-641138828646.europe-west1.run.app/generate-pdf
supabase secrets set PDF_GENERATOR_SECRET=...
supabase secrets set RESEND_API_KEY=...
supabase secrets set ADMIN_EMAIL=dror@cargonex.io
supabase secrets set SEND_QUOTE_LINKS_URL=https://tjitewgiszukqyjujxrh.supabase.co/functions/v1/send-quote-links

# Cloud Run (pdf-generator)
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
PDF_GENERATOR_SECRET=...
RESEND_API_KEY=...
OWNER_EMAIL=dror@cargonex.io
FROM_EMAIL=CargoNex <hello@cargonex.io>

# Cloudflare Worker
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...
```

---

*Review generated by Claude Sonnet 4.6 — 2026-05-30*
