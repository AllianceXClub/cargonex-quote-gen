# CargoNex Quote-Gen — Product Requirements Document

**Version:** 1.2
**Date:** 2026-05-24
**Project:** Web-Native Price Quote System
**Context:** Ventures / CargoNex.io
**Changes from v1.1:** Locked PDF generation tech to **Playwright** (replaces html2canvas + jsPDF). Signed PDF delivered via **secure link in email body** — not as email attachment.

---

## 1. Project Overview

CargoNex needs a **Web-Native Quote Delivery System** — replacing static Word/PDF documents with dynamic, branded landing pages that get sent to prospects.

**End-to-end flow:**
1. **Admin fills a fixed HTML form** with client details (new or existing) and deal details.
2. The form **generates a branded landing page** (the quote) with commercial terms, legal clauses, and conditions tailored to the deal.
3. The quote is delivered as a **secure link or PDF** via email, WhatsApp, or Telegram.
4. The client opens the page, reviews the offer, and **signs electronically** from any channel.
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

---

## 3. Design System

**Reference file:** `DESIGN.md` (in this folder) — single source of truth for all visual decisions.

**Key rules:**
- Background: `#0A0A0A` (deep black)
- Accent: `#E74C3C` (neon red)
- All panels: glassmorphism (`backdrop-filter: blur(12px)`, `rgba(255,255,255,0.03)` bg)
- Typography: Inter or Heebo (RTL-friendly for Hebrew content)
- All CTAs: neon red solid button with glow on hover
- Transitions: 300ms cubic-bezier

**Language:** Hebrew (RTL layout). UI labels may be bilingual where needed.

---

## 4. Quote Page Structure

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
- 3 pain points (editable per client via form)
- Visual: icon cards with subtle red glow

### Section 3 — The Solution (What They Get)
- Headline: "מה אנחנו בונים לכם"
- 3 benefit tiles (editable per client via form)
- Visual style: glassmorphism cards, red accent icons

### Section 4 — Commercial Offer (Pricing Table)
- Two-row pricing table:
  - **הטמעה מקוסטמת** (Custom Setup) — One-time fee
  - **תשתית + רישוי SaaS** (Monthly MRR) — Recurring fee
- Fields: Service name | Type | Price (₪) | VAT note
- Total annual commitment line
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
- Drawn or typed signature (canvas or text-to-sig)
- Checkbox: "קראתי ואני מסכים לתנאים"
- Primary CTA button: **"חותם על ההצעה ומאשר"**
- On submit: confirmation screen + timestamp + auto-generated PDF emailed to both parties

---

## 5. Feature Specifications

### 5.1 Security & URL Model — NEW

**Problem solved:** Sequential IDs (`CN-QUO-2026-001`) let a competitor enumerate URLs and read other clients' pricing.

**URL structure:**
```
https://quotes.cargonex.io/q/CN-QUO-2026-001?t=<random_token>
```
- `CN-QUO-2026-001` = human-readable slug (used internally + in filenames).
- `t=<token>` = 32-character cryptographically random URL-safe token (e.g., `nanoid(32)`).
- Server validates `slug + token` pair before serving content.
- Without the token, the page returns 404.
- Tokens are stored hashed (not plain) in the backend.

**Rate limiting:** Max 20 token-validation attempts per IP per hour.

### 5.2 Electronic Signature — Legal Compliance

**Applicable law:** Israeli Electronic Signature Law, 5761-2001 (חוק חתימה אלקטרונית, התשס"א-2001).

**To qualify as a legally binding "regular electronic signature" (חתימה אלקטרונית רגילה), we capture:**

| Field | Purpose |
|-------|---------|
| Signer full name (typed) | Identity |
| Signer email + phone | Identity verification channels |
| Drawn signature image (Canvas PNG) | Intent + uniqueness |
| Explicit consent checkbox state | Intent + agreement to terms |
| ISO 8601 timestamp (server-side) | When |
| IP address + user-agent | Audit trail |
| Hash of the full quote HTML at signing time | Proves *what* was signed |
| Unique signature ID (UUID) | Reference |

**Storage:**
- Audit record stored in Supabase table `quote_signatures` (immutable — no UPDATE allowed, only INSERT).
- Daily encrypted backup to S3 / Google Drive.
- **Retention period: 7 years** (matches Israeli commercial document standard).

**Optional Phase 3:** Integrate certified e-signature provider (DocuSign / Comda) for higher-assurance "secured signature" status (חתימה אלקטרונית מאובטחת).

### 5.3 Signed PDF — Mandatory, Auto-Generated

**PDF generation engine: Playwright (headless Chromium)**
- Runs server-side on the webhook receiver (Node.js).
- Playwright opens the full quote HTML → renders → exports to PDF.
- Full fidelity: RTL, Hebrew fonts (Heebo), glassmorphism, exact pixel output.
- No browser dependency on the client — 100% server-side, agent-runnable.

**On successful signature submission:**
1. Playwright renders the full quote (all sections + signature block + audit metadata) to PDF.
2. PDF is stored in **Supabase Storage** and a **time-limited signed URL** is generated (valid 7 days).
3. Email is sent to both parties with the **PDF link in the email body** — no attachment.
   - The signing client (email from signature form).
   - The deal owner (Dror / Avi).
4. PDF includes a footer: signer name, timestamp, signature hash, quote ID.
5. The live quote URL switches to "signed" state and shows the same PDF download link.

**Email delivery — link, not attachment:**
```
נושא: ההצעה נחתמה — [quote_id] | CargoNex

שלום [contact_name],

ההצעה נחתמה בהצלחה ב-[timestamp].

📄 להורדת העותק החתום:
[signed_pdf_url]

הלינק תקף ל-7 ימים.

[sender_name]
```

**No PDF = no proof.** This is non-negotiable.

### 5.4 Quote Versioning — NEW

**When the client requests changes:**
1. Admin edits the quote via the form generator.
2. System keeps the same slug (`CN-QUO-2026-001`) but **revokes the old token** and issues a new one.
3. The old URL now shows: "ההצעה עודכנה — אנא פנה אל מוסר ההצעה לקבלת הקישור החדש".
4. **Auto-notification (email + WhatsApp) sent to the client:** "ההצעה שלך עודכנה. הלינק החדש: [new URL]".
5. Previous signature records (if any) remain immutable; new version starts fresh.

**Version history table** kept in backend for audit (who edited, when, what changed).

### 5.5 Expired State — NEW

When a client opens a quote past `date_expiry`:
- Page renders normally but signature block is **disabled**.
- Banner replaces CTA: "ההצעה פגה ב-[date]. ליצירת קשר ולקבלת הצעה מעודכנת:"
- Shows quote owner's contact details: **name, email, phone, WhatsApp link**.
- Expired-state view still fires `quote_opened_expired` event so we know they came back.

### 5.6 Analytics & View Tracking

| Event | When |
|-------|------|
| `quote_opened` | Page load (valid token) |
| `quote_opened_expired` | Page load after expiry |
| `quote_opened_invalid_token` | Bad/missing token attempt |
| `section_viewed` | Each section scrolled into view (Intersection Observer) |
| `terms_expanded` | Accordion item opened |
| `cta_clicked` | Signature button tapped |
| `quote_signed` | Signature submitted |
| `time_on_page` | Session duration (sent on unload) |

**Event payload schema:**
```json
{
  "event": "quote_opened",
  "quote_id": "CN-QUO-2026-001",
  "timestamp": "2026-05-23T14:30:00Z",
  "session_id": "uuid-v4",
  "user_agent": "...",
  "ip_hashed": "...",
  "metadata": { /* event-specific */ }
}
```

### 5.7 Webhook Hardening — NEW

**All events flow through a hardened pipeline:**
1. **Auth:** Bearer token (HMAC-signed payloads) on every webhook call.
2. **Local logging:** Every event written to `localStorage` on the client first, then POSTed.
3. **Retry policy:** 3 attempts with exponential backoff (1s, 4s, 16s) on the client side.
4. **Server-side buffer:** Supabase Edge Function receives events and writes to `quote_events` table. If write fails, event goes to a dead-letter queue.
5. **Reconciliation:** Daily cron compares localStorage logs (uploaded on next page load) vs server records to catch drops.

**Admin notifications:**
- Email + WhatsApp on `quote_opened` (first time only) and `quote_signed`.
- Channel: n8n workflow OR direct via Resend (email) + WhatsApp Cloud API.

### 5.8 Link Delivery — NEW

**Channels:** Email, WhatsApp (personal/business), Telegram.

**Templates (per channel, Hebrew, editable):**

**Email template:**
```
נושא: הצעת מחיר מ-CargoNex — [client_name]
שלום [contact_name],
מצורף לינק להצעת המחיר שהכנו עבורכם:
👉 [secure_url]
ההצעה תקפה עד [date_expiry].
לכל שאלה — אני זמין.
[sender_name]
[sender_phone]
```

**WhatsApp/Telegram template:**
```
שלום [contact_name] 👋
הכנו עבורכם הצעת מחיר. אפשר לעבור עליה ולחתום ישירות מהנייד:
🔗 [secure_url]
תקף עד [date_expiry]
```

The form generator outputs all three templates ready to copy-paste.

### 5.9 Conversion Optimization Design Rules

- **Urgency indicator:** Expiry countdown badge in the header (e.g., "ההצעה תפוג בעוד 7 ימים")
- **Social proof strip (Phase 1):** Generic placeholder — "לקוחות מתעשיית הלוגיסטיקה" + neutral icons. **No real third-party logos until permission obtained.**
- **Social proof strip (Phase 2):** Upgrade to actual client logos with written permission.
- **Progress bar:** Subtle scroll progress indicator at top of page
- **Sticky CTA:** "לחתימה ←" floating button appears after 50% scroll
- **No distractions:** No nav, no links out, no header menu — quote only
- **Mobile-first:** Full RTL mobile layout, large tap targets, signature on phone

---

## 6. Technical Architecture

### Phase 1 — HTML Form Generator + Static Quote Pages (MVP)

**Architecture:**
- Single-page HTML form (`generator.html`) with all input fields for client + deal details.
- On submit, JavaScript fills a template HTML string with the form data and triggers a **download** of the generated quote file (`quote-[slug]-[token].html`).
- Admin manually uploads the file to hosting (Netlify / Vercel / GitHub Pages) — or scripted upload via Netlify CLI.
- Signature submissions POST to a single webhook (n8n / Supabase Edge Function).
- PDF generation done server-side on the webhook receiver.

**Pros:** Zero backend infra for the page itself, fast to ship, full control.
**Cons:** Manual upload step per quote, no central dashboard yet.

### Phase 3 — Dynamic System (Full Stack)

- Next.js app with `/q/[slug]?t=[token]` routes
- Quote data stored in Supabase
- Admin UI replaces the static form
- Real-time dashboard for tracking
- Native PDF generation: **Playwright** (headless Chromium, server-side)

**Recommendation:** Start with Phase 1. Promote to Phase 3 only after 10+ quotes sent and format validated.

---

## 7. Quote Template Data Model

```json
{
  "quote_id": "CN-QUO-2026-001",
  "url_token": "<random_32_char_token>",
  "client_name": "שם החברה",
  "client_id": "optional_existing_client_id",
  "contact_name": "שם איש קשר",
  "contact_email": "client@example.com",
  "contact_phone": "+972-50-XXXXXXX",
  "date_issued": "2026-05-23",
  "date_expiry": "2026-06-06",
  "currency": "ILS",
  "vat_included": false,
  "setup_fee": 15000,
  "monthly_fee": 4500,
  "pain_points": ["custom line 1", "custom line 2", "custom line 3"],
  "benefits": ["custom benefit 1", "custom benefit 2", "custom benefit 3"],
  "notes": "הערות נוספות אופציונליות",
  "sender_name": "דרור",
  "sender_email": "dror@cargonex.io",
  "sender_phone": "050-650-3272",
  "version": 1
}
```

---

## 8. Implementation Phases & Definition of Done

### Phase 1 — MVP (Now)
- [ ] Build `generator.html` form with all fields from data model
- [ ] Build single HTML quote template using `DESIGN.md` brand system
- [ ] All 6 sections fully designed and RTL
- [ ] Secure URL with slug + random token validation
- [ ] Canvas signature + submit button
- [ ] Basic view tracking (events to webhook with auth + retry)
- [ ] Auto-PDF generation + email to both parties on sign
- [ ] Expired state UI with sender contact details
- [ ] Mobile responsive
- [ ] Generic "logistics industry clients" social proof (no real logos)
- [ ] Send first 3 real quotes

### Phase 2 — Analytics Layer
- [ ] Full scroll-depth tracking (section by section, dwell time per section)
- [ ] Admin notification on open + sign (email + WhatsApp)
- [ ] Quote versioning flow with token revocation + client notification
- [ ] Real client logos (with written permission) on social proof strip
- [ ] Dashboard: simple HTML page listing all quotes + status

### Phase 3 — Dynamic System
- [ ] Next.js + Supabase backend
- [ ] Admin UI replaces static form
- [ ] Full quote dashboard with status (Sent / Viewed / Signed / Expired)
- [ ] Certified e-sig integration (DocuSign / Comda) for high-stakes deals
- [ ] CRM hookup (optional)

### Definition of Done — Graded Success Scale

Per-quote success measured on this scale:

| Stage | Score |
|-------|-------|
| Quote sent | 0% |
| Quote opened (any time) | 50% |
| Read for >3 minutes | 70% |
| Client responded (questions / change request) | 90% |
| Quote signed | 100% |

**Phase-level success criteria:**
- **Phase 1 done when:** 3 real quotes sent, average score ≥ 70%.
- **Phase 2 done when:** 10 real quotes sent, average score ≥ 80%, conversion-to-signed ≥ 40%.
- **Phase 3 done when:** 25+ quotes sent, conversion-to-signed ≥ 50% (the headline target).

---

## 9. File Structure (This Project)

```
Quote-Gen/
├── PRD.md                          ← v1.0 (kept for history)
├── PRD_v1.1.md                     ← This file (current source of truth)
├── DESIGN.md                       ← Brand system (source of truth)
├── CargoNex Price Quote Template V2.docx  ← Original Word template
├── generator.html                  ← Form generator (Phase 1)
├── quote-template-v1.html          ← MVP quote HTML template (to be built)
├── quotes/
│   └── quote-[slug]-[token].html   ← Generated per-client files
└── assets/
    └── logo.png / logo.svg         ← CargoNex logo
```

---

## 10. Out of Scope (for now)

- Multi-language (EN) — Hebrew only for now
- Payment processing
- CRM integration
- Video embeds
- Custom domain per quote
- Certified secured signature (חתימה מאובטחת) — Phase 3 only if needed

---

## 11. Open Questions to Resolve Before Build

1. **Hosting:** Netlify, Vercel, or GitHub Pages for Phase 1?
2. **Webhook backend:** n8n (self-hosted) or Supabase Edge Function?
3. **PDF generation service:** ✅ Confirmed — **Playwright** on webhook receiver (Node.js). No SaaS needed.
4. **Email sending:** Resend, SendGrid, or Gmail SMTP?
5. **WhatsApp notifications:** Cloud API (Meta) or a 3rd-party like Twilio?
6. **Domain for quote links:** `quotes.cargonex.io` subdomain — needs DNS setup.

---

## Key Contacts

- **Dror** — Product owner, dror@cargonex.io, 050-650-3272
- **Avi** — 050-226-5757
- **Website:** [www.cargonex.io](https://www.cargonex.io)
- **Email:** hello@cargonex.io
