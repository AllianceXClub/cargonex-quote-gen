# CargoNex Quote-Gen — Product Requirements Document

**Version:** 1.3
**Date:** 2026-06-08
**Project:** Web-Native Price Quote System
**Context:** Ventures / CargoNex.io
**Supersedes:** PRD_v1.2.md (kept for history)

**Changes from v1.2:**
1. **New dedicated PDF Output Specification (Section 5.3)** — defines the two PDF generation modes (Preview / manual-sign, and Signed copy), and locks the output as a **clean, readable WHITE document — never a screenshot/image of the dark page**.
2. **Stamp & authorized-signature model locked** — symmetric two-party signatory blocks (client side + CargoNex side), each with **name · role · signature · date**, plus an **uploadable client company stamp**. **No CargoNex stamp exists yet** — its stamp area stays empty (the logo is **not** used as a stamp substitute).
3. **Data model extended** — added `signer_role` (תפקיד מורשה החתימה).
4. **Design clarified** — the live quote page stays dark glassmorphism; the **PDF is a separate white branded surface**. Dark glassmorphism is no longer a PDF requirement.
5. **Logo** — real `cargonex logo.png` embedded as base64 in the PDF header (replaces the text wordmark).
6. **Gap status table added (Section 12)** — what's fixed, what's open, mapped to GAP_ANALYSIS v1.0.

---

## 1. Project Overview

CargoNex needs a **Web-Native Quote Delivery System** — replacing static Word/PDF documents with dynamic, branded landing pages that get sent to prospects.

**End-to-end flow:**
1. **Admin fills a fixed HTML form** (`generator.html`) with client details (new or existing) and deal details.
2. The form **generates a branded landing page** (the quote) with commercial terms, legal clauses, and conditions tailored to the deal.
3. The quote is delivered as a **secure link or PDF** via email, WhatsApp, or Telegram.
4. The client opens the page, reviews the offer, and **signs electronically** from any channel — OR signs **manually on a printed PDF** (see two PDF modes below).
5. Both parties **automatically receive a signed PDF** with timestamp and audit trail.

**Core problem it solves:** Static Word docs have no conversion data, no signing flow, and no brand experience. They look cheap. This system fixes all three.

---

## 2. Goals & Success Metrics

| Goal | Metric |
|------|--------|
| Increase quote-to-signature rate | **Target: ≥50% close rate** (send → signed) |
| Eliminate manual signing friction | 0 back-and-forth PDFs |
| Know when a client viewed the quote | Real-time view event tracking |
| Professional brand impression | Consistent with cargonex.io |
| Time from "deal agreed" to "quote sent" | < 5 minutes via form generator |
| **PDF is a permanent, professional, fully-readable record** | **Every signed PDF contains all quote details + stamp + signature, white & legible** |

---

## 3. Design System — Two Surfaces

**Reference file:** `DESIGN.md` (in this folder) — source of truth for the **live web** experience.

### 3.1 Surface A — Live Quote Page (web)
The interactive page the client opens and signs on.
- Background: `#0A0A0A` (deep black)
- Accent: `#E74C3C` (neon red)
- Glassmorphism panels (`backdrop-filter: blur(12px)`)
- Typography: Inter or Heebo (RTL-friendly)
- All CTAs: neon red solid button with glow on hover
- Language: Hebrew (RTL layout)

### 3.2 Surface B — PDF Output (document) — **CHANGED in v1.3**
The PDF is a **separate, white, print-grade document** — NOT a screenshot or pixel-copy of the dark page.

**Locked rules:**
- **White background**, black/grey readable text. Print-safe.
- **Branded header**: embedded CargoNex logo (PNG → base64) + a red bottom rule (`#E74C3C`). Red used only as an accent (header rule, totals, section labels).
- **All quote content is rendered as real selectable text** — pains, benefits, pricing table, legal terms, signature block, footer. No content delivered as a flattened image.
- **No dark glassmorphism in the PDF.** (This explicitly overrides the v1.2 line "Full fidelity glassmorphism".)
- RTL Hebrew throughout; Latin fragments (email, UUID) forced LTR inside their own spans.
- Engine: Playwright builds a purpose-made white HTML template (`buildPrintHtml`) and prints it — it does **not** print the dark page.

> **Why:** the client keeps this PDF forever. It must read like a clean, signable commercial document, not a screenshot of a website.

---

## 4. Quote Page Structure (Live Page)

Each quote is a **single-page vertical scroll** with the following sections, in order:

### Section 1 — Hero / Header
- CargoNex logo + tagline
- Quote ID (e.g., `CN-QUO-2026-001`)
- Recipient company name + contact name
- Date issued + expiry date
- Animated status badge: "ממתין לחתימה" (Awaiting Signature)
- Expiry countdown badge

### Section 2 — Business Context
- Headline: "מה זיהינו אצלכם"
- Up to 3 pain points (editable per client via form; **min 1**)
- Visual: icon cards with subtle red glow

### Section 3 — The Solution (What They Get)
- Headline: "מה אנחנו בונים לכם"
- Up to 3 benefit tiles (editable per client via form; **min 1**)
- Visual style: glassmorphism cards, red accent icons

### Section 4 — Commercial Offer (Pricing Table)
- Two-row pricing table:
  - **הטמעה מקוסטמת** (Custom Setup) — One-time fee
  - **תשתית + רישוי SaaS** (Monthly MRR) — Recurring fee
- Fields: Service name | Type | Price (₪) | VAT note
- Total annual commitment line (= setup + monthly × 12)
- Visual: dark table with red header row, subtle borders

### Section 5 — Terms Summary
- 5 collapsible accordion items:
  1. מבנה התקשרות ותשלומים
  2. קניין רוחני וזכויות שימוש
  3. הגבלת אחריות מקצועית
  4. סודיות
  5. דין וסמכות שיפוט
- Collapsed by default — clean look, expandable on tap

### Section 6 — Electronic Signature Block (CTA)
- Full-name input field
- **Role / title field (תפקיד מורשה החתימה)** — NEW in v1.3
- Drawn or typed signature (canvas or text-to-sig)
- **Company stamp upload (client side)** — NEW, see 5.4
- Checkbox: "קראתי ואני מסכים לתנאים"
- Primary CTA button: **"חותם על ההצעה ומאשר"**
- On submit: confirmation screen + timestamp + auto-generated PDF emailed to both parties

---

## 5. Feature Specifications

### 5.1 Security & URL Model

**Problem solved:** Sequential IDs let a competitor enumerate URLs and read other clients' pricing.

**URL structure:**
```
https://quotes.cargonex.io/q/CN-QUO-2026-001?t=<random_token>
```
- `CN-QUO-2026-001` = human-readable slug (used internally + in filenames).
- `t=<token>` = cryptographically random URL-safe token (UUID v4 / nanoid).
- Server validates `slug + token` pair before serving content.
- Without a valid token, the page returns 404 / invalid state.
- Token hashing in DB is deferred to Phase 3 (UUID v4 = 128-bit entropy; acceptable at ~10 quotes/month).

**Rate limiting:** Max 20 token-validation attempts per IP per hour (target).

### 5.2 Electronic Signature — Legal Compliance

**Applicable law:** Israeli Electronic Signature Law, 5761-2001 (חוק חתימה אלקטרונית, התשס"א-2001).

**Captured for a legally binding "regular electronic signature" (חתימה אלקטרונית רגילה):**

| Field | Purpose |
|-------|---------|
| Signer full name (typed) | Identity |
| **Signer role / title (תפקיד)** — NEW | Authority to sign (מורשה חתימה) |
| Signer email + phone | Identity verification channels |
| Drawn signature image (Canvas PNG) **or** uploaded combined image | Intent + uniqueness |
| **Company stamp image (optional, client)** — see 5.4 | Corporate authorization |
| Explicit consent checkbox state | Intent + agreement to terms |
| ISO 8601 timestamp (server-side) | When |
| IP address + user-agent | Audit trail |
| Hash of the full quote HTML at signing time | Proves *what* was signed |
| Unique signature ID (UUID) | Reference |

**Storage:**
- Audit record in Supabase table `quote_signatures` (immutable — INSERT only, no UPDATE except `pdf_url`).
- `UNIQUE (quote_id, signer_email)` prevents double-signing on double-click.
- Retention period: **7 years** (Israeli commercial document standard).

**Optional Phase 3:** Certified e-signature provider (DocuSign / Comda) for "secured signature" status (חתימה אלקטרונית מאובטחת).

### 5.3 PDF Output — Two Modes — **NEW / EXPANDED in v1.3**

There are **two** situations where a PDF of the quote is produced. **In both, the PDF must be a clean white readable document — never a screenshot/image — and must contain every detail shown in the quote.**

#### Mode 1 — Preview PDF (manual signing path)
**When:** the client does **not** want to sign via the link, and prefers to sign by hand on a PDF.
**Trigger:** "📄 הורד PDF" button in the generator Preview modal → `pdf-proxy` → `/preview-pdf`.
**Content:**
- Full quote: header + logo, client/meta block, pains, benefits, full pricing table + annual total, full legal terms.
- **Two symmetric signing blocks to be completed by hand** — same labelled lines on both sides: **שם מלא · תפקיד · חתימה · תאריך**.
  - **Client side** (הלקוח) + **bordered company-stamp area** (חותמת חברה).
  - **CargoNex side** with the identical fields + a stamp area that **stays empty for now** (no CargoNex stamp asset yet; do not place the logo there).
- No "signed" badge, no signature image, no audit UUID (it is not signed yet).
- Filename: `{quote_id}-preview.pdf`.

#### Mode 2 — Signed PDF (electronic signing path)
**When:** the client signs electronically through the link.
**Trigger:** `sign-quote` → `pdf-generator /generate-pdf` (fire-and-forget, admin-alert on failure).
**Content:** identical white layout as Mode 1, plus:
- **"✓ נחתם" badge** + diagonal **"נחתם"** watermark on page 1 (distinguishes signed from preview).
- **Client side:** signer **name + role**, captured **signature image** (on white/transparent background), signing **date/time** ("7.6.2026 בשעה 21:02"), **signer phone**, **signature UUID**, and **client company stamp** (if uploaded).
- **CargoNex side:** the **same fields** (name · role · signature · date) filled from the deal owner / sender details, so the document reads as signed by both parties. **Stamp area stays empty** until a CargoNex stamp exists.
- Footer: electronic-signature legal line (RTL) + `CargoNex | hello@cargonex.io | cargonex.io` (LTR) + signature ID (LTR).
- Stored in `signed-quotes` (public bucket) → **permanent URL** → emailed to signer + owner + viewers (link in body, no attachment).

#### Shared PDF requirements (both modes)
- White background, real text, RTL, Heebo font (with timeout fallback).
- Embedded CargoNex logo (base64) in header.
- Every quote detail present and legible; empty sections show a placeholder line, never crash or disappear.
- A4, 15mm margins, `printBackground: true`.
- Target: fits in ≤ 2 pages for a standard quote (no large blank trailing page).

### 5.4 Stamps & Authorized Signature — **NEW in v1.3 (symmetric, two-party)**

The signatory area is **symmetric**: the same set of fields appears on **both** the client side and the CargoNex side.

**Signatory fields (identical on both sides):** **שם מלא · תפקיד · חתימה · תאריך** + a company-stamp area.

**A. Client side (their company)**
- The signer fills name, role/title, signature, date.
- The signer can **manually upload a company-stamp image** during electronic signing, or apply a stamp by hand on the printed preview.
- Two supported combinations, both mandatory to offer:
  1. **Company stamp image only.**
  2. **Company stamp + authorized-signatory signature** (name + role + drawn/typed signature).
- Client stamp uploaded → stored in `signature-stamps` bucket → embedded into the signed PDF.

**B. CargoNex side (our company)**
- The **same fields** (name · role · signature · date) appear, filled from the deal owner / sender details.
- **No CargoNex company stamp exists yet** → the stamp area **stays empty**. Do **not** use the CargoNex logo as a stamp substitute. (When a real stamp is provided later, drop it into this area.)

**Stamp bucket policy (locked):** `signature-stamps` is **public** with permanent `getPublicUrl` — same permanence as the signed PDF. Resolves the GAP-14 mismatch (PDF permanent vs stamp URL expiring 2033).

**Layout intent:** two columns side by side — **client (signature + stamp)** | **CargoNex (signature + empty stamp area)** — so the document reads as authorized by both parties.

### 5.5 Quote Versioning

When the client requests changes:
1. Admin edits the quote via the generator.
2. System keeps the same slug, **revokes the old token**, issues a new one.
3. Old URL shows: "ההצעה עודכנה — אנא פנה אל מוסר ההצעה לקבלת הקישור החדש".
4. Auto-notification (email + WhatsApp) to client with the new link.
5. Previous signature records remain immutable; new version starts fresh.

Version history table kept for audit (who edited, when, what changed). *(Phase 2/3.)*

### 5.6 Expired State

When a client opens a quote past `date_expiry`:
- Page renders normally but signature block is **disabled**.
- Banner replaces CTA: "ההצעה פגה ב-[date]. ליצירת קשר ולקבלת הצעה מעודכנת:" + owner name, email, phone, WhatsApp link.
- Fires `quote_opened_expired` event.

### 5.7 Analytics & View Tracking

| Event | When |
|-------|------|
| `quote_opened` | Page load (valid token) |
| `quote_opened_expired` | Page load after expiry |
| `quote_opened_invalid_token` | Bad/missing token attempt |
| `section_viewed` | Each section scrolled into view |
| `terms_expanded` | Accordion item opened |
| `cta_clicked` | Signature button tapped |
| `quote_signed` | Signature submitted |
| `time_on_page` | Session duration (on unload) |

### 5.8 Webhook & Reliability Hardening

- **Auth:** Bearer secret on `pdf-generator`; `PDF_GENERATOR_SECRET` hidden behind `pdf-proxy` Edge Function (never in client).
- **PDF delivery visibility:** `sign-quote` tracks the generator response; on non-2xx it emails an admin alert (🚨 PDF נכשל). Health check on `/health` (UptimeRobot).
- **Permanent PDF URL:** `signed-quotes` bucket public + `getPublicUrl` (no 7-day expiry).
- **Cold start:** Cloud Run `min-instances=1` (~$6/mo) to keep PDF generation warm.
- **Startup guard:** generator refuses to start if required env vars are missing.

### 5.9 Link Delivery

**Primary channel (locked): Email** via Resend. WhatsApp / Telegram templates are still generated for copy-paste, but **email is the confirmed, supported delivery + notification channel** for now. WhatsApp Cloud API is deferred to a later phase.

### 5.10 Conversion Optimization Design Rules (live page)

Urgency expiry countdown; generic logistics social-proof (no real logos until permission); scroll progress bar; sticky "לחתימה ←" CTA after 50% scroll; no nav/links out; mobile-first RTL.

---

## 6. Technical Architecture

### Current (Phase 1 + Phase 2 in progress)
```
Admin fills generator.html → "אשר ושלח"
  → upload-quote (Edge Fn) → quotes-html bucket + quotes table (html_content)
      → send-quote-links → signer + viewer tokens (30d) → Resend emails

Client opens quotes.cargonex.io/quote-XX.html?t=TOKEN
  → Cloudflare Worker → fetch from Supabase Storage (service key) → HTML
  → quote-template-v1.html → token validated → reads → track-event fires

Client signs (electronic)         |  OR  | Client signs manually
  → sign-quote (Edge Fn)          |      |  → generator Preview → "הורד PDF"
     token validated (role+expiry)|      |     → pdf-proxy → /preview-pdf
     stamp uploaded → Storage     |      |     → white PDF (blank signing block + stamp area)
     quote_signatures INSERT      |      |     → client prints, signs, stamps by hand
     → /generate-pdf (Cloud Run)  |
        Playwright → WHITE buildPrintHtml
        → signed-quotes (public) → permanent URL
        → Resend → signer + owner + viewers
```

### Phase 3 — Dynamic System
Next.js + Supabase, `/q/[slug]?t=[token]` routes, admin UI replaces static form, real-time dashboard, optional certified e-sig.

---

## 7. Quote / Signature Data Model

```json
{
  "quote_id": "CN-QUO-2026-001",
  "url_token": "<random_token>",
  "client_name": "שם החברה",
  "contact_name": "שם איש קשר",
  "contact_email": "client@example.com",
  "contact_phone": "+972-50-XXXXXXX",
  "date_issued": "2026-05-23",
  "date_expiry": "2026-06-06",
  "currency": "ILS",
  "vat_included": false,
  "setup_fee": 15000,
  "monthly_fee": 4500,
  "pain_points": ["line 1", "line 2", "line 3"],
  "benefits": ["benefit 1", "benefit 2", "benefit 3"],
  "notes": "הערות אופציונליות",
  "sender_name": "דרור",
  "sender_email": "dror@cargonex.io",
  "sender_phone": "050-650-3272",
  "version": 1
}
```

**Signature record (extended in v1.3):**
```json
{
  "id": "<uuid>",
  "quote_id": "CN-QUO-2026-001",
  "signer_name": "שם החותם",
  "signer_role": "מנכ\"ל / מורשה חתימה",   // NEW
  "signer_email": "client@example.com",
  "signer_phone": "+972-50-XXXXXXX",
  "signature_type": "drawn | digital",
  "signature_image": "<base64 png>",
  "stamp_image_url": "<storage url, client stamp>",
  "signed_at": "2026-06-07T21:02:00Z",
  "ip_address": "...",
  "user_agent": "...",
  "pdf_url": "<permanent public url>"
}
```

---

## 8. Implementation Phases & Definition of Done

### Phase 1 — MVP ✅ (largely done)
Generator form, dark quote template (6 sections, RTL), secure URL + token, canvas signature + submit, basic tracking, auto-PDF + email on sign, expired state, mobile responsive.

### Phase 2 — Reliability + PDF quality + Stamps (current focus)
- [x] Permanent PDF URL (public bucket)
- [x] PDF failure admin alert + `/health`
- [x] Full white PDF render with all sections (`buildPrintHtml`)
- [x] Hebrew date format fixed
- [x] RTL footer fixed
- [x] `calcTotal` annual total
- [ ] **Signature image on white/transparent background** (GAP-05 — still dark `#1a1a1a`)
- [ ] **Embed real CargoNex logo (base64) in PDF header** (GAP-02)
- [ ] **Render client stamp in signed PDF** (`buildPrintHtml` has no stamp param — passed but dropped)
- [ ] **Symmetric two-party signatory blocks** (client + CargoNex, each name·role·signature·date); CargoNex stamp area left empty
- [ ] **Preview PDF: two blank signing blocks (name·role·signature·date) + client stamp area**
- [ ] **Preview stamp upload field in generator**
- [ ] **`signer_role` captured + shown in PDF**
- [ ] **`signer_phone` shown in PDF**
- [ ] "מה הצעד הבא?" next-steps block before footer (GAP-11)
- [ ] "SIGNED / נחתם" watermark on signed PDF only (GAP-07)
- [ ] Stamp URL permanence aligned with PDF (GAP-14)
- [ ] Label consistency pass (GAP-12)
- [ ] Empty-section placeholders (GAP-13)

### Phase 3 — Dynamic System
Next.js + Supabase backend, admin UI, full dashboard (Sent/Viewed/Signed/Expired), certified e-sig, optional CRM.

### Definition of Done — Graded Success Scale
| Stage | Score |
|-------|-------|
| Quote sent | 0% |
| Quote opened | 50% |
| Read > 3 min | 70% |
| Client responded | 90% |
| Quote signed | 100% |

- **Phase 1 done:** 3 real quotes sent, avg score ≥ 70%.
- **Phase 2 done:** 10 real quotes, avg ≥ 80%, signed ≥ 40%, **PDF passes the PDF DoD below**.
- **Phase 3 done:** 25+ quotes, signed ≥ 50%.

### Definition of Done — PDF (both modes)
- [ ] White, fully readable, real text (not an image) — RTL correct
- [ ] CargoNex logo embedded (base64), header branded
- [ ] All sections present (pains, benefits, pricing + annual total, terms)
- [ ] Footer correct in Hebrew + LTR fragments
- [ ] **Signed mode:** client signer name + role + phone, signature on white bg, date "7.6.2026 בשעה 21:02", UUID, "נחתם" badge + watermark; CargoNex side filled with matching name·role·signature·date
- [ ] **Preview mode:** two blank signing blocks (name·role·signature·date) + client stamp area
- [ ] **Client stamp rendered when provided; CargoNex stamp area present but empty (no asset yet)**
- [ ] No empty trailing page; placeholders for empty sections

---

## 9. File Structure

```
Quote-Gen/
├── PRD_v1.2.md                       ← previous (history)
├── PRD_v1.3.md                       ← THIS FILE (current source of truth)
├── DESIGN.md                         ← live-page brand system
├── GAP_ANALYSIS_v1.0.md              ← gap report
├── WORKPLAN_v2.0_FINAL.md            ← Phase 2 build plan
├── ADR_PDF_DELIVERY.md               ← PDF delivery decisions
├── generator.html                    ← form generator
├── quote-template-v1.html            ← live dark quote template
├── pdf-generator/index.js            ← Playwright white-PDF builder (/generate-pdf, /preview-pdf)
├── supabase/functions/               ← sign-quote, upload-quote, pdf-proxy, send-quote-links, track-event
├── quotes/                           ← Cloudflare Worker + generated files
└── assets/
    └── cargonex logo.png             ← embedded (base64) into PDF header
```

---

## 10. Out of Scope (for now)

Multi-language (EN), payment processing, CRM integration, video embeds, custom domain per quote, certified secured signature (Phase 3 only).

---

## 11. Decisions Locked (v1.3)

All prior open questions are now resolved:
1. **PDF visual** ✅ — clean white document + branded header. Dark glassmorphism dropped from the PDF.
2. **Logo** ✅ — real `cargonex logo.png` embedded as base64 in the PDF header.
3. **CargoNex stamp asset** ✅ — none exists yet → CargoNex stamp area stays **empty**; the logo is **not** used as a stamp.
4. **Two-party signatory** ✅ — symmetric blocks: client and CargoNex each show **name · role · signature · date**.
5. **Watermark wording** ✅ — **"נחתם"** (Hebrew only).
6. **Stamp bucket** ✅ — `signature-stamps` is **public**, permanent URL.
7. **Delivery channel** ✅ — **Email** (Resend). WhatsApp deferred.

**Remaining infra confirmations (non-blocking):** Cloudflare Worker + Supabase Storage confirmed; DNS for `quotes.cargonex.io` subdomain.

---

## Key Contacts
- **Dror** — Product owner, Dror@cargonex.io, 050-650-3272
- **Avi** — Avi@cargonex.io, 050-226-5757
- **Website:** www.cargonex.io · **Email:** Dror@cargonex.io
