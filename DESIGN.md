# CargoNex Core Design System

This document serves as the single source of truth for all future React components, establishing the ultimate B2B SaaS landing page design language for CargoNex.

## 1. Brand & Core Colors

Our aesthetic is a futuristic, high-tech logistics dashboard in dark mode, defined by maximum contrast and premium tech vibes.

### Primary Colors

- **Dark Background (Base):** `#0A0A0A`
- **Neon Red (Accent/Active):** `#E74C3C`

### Extended Dark Mode Palette

- **Background (Surface/Panel Base):** `rgba(20, 20, 20, 0.6)` for glassmorphism panels.
- **Card Background:** `rgba(26, 26, 26, 0.4)`
- **Border/Subtle Divide:** `rgba(255, 255, 255, 0.08)`
- **Hover/Glow Focus:** `rgba(231, 76, 60, 0.4)`
- **Text (Primary):** `#FFFFFF` (or `rgba(255, 255, 255, 0.9)`)
- **Text (Secondary/Muted):** `rgba(255, 255, 255, 0.6)`

## 2. Typography Scale

We use clean, modern, crisp typography (e.g., 'Inter', 'Poppins', or 'Heebo') that feels technical and legible on dark backgrounds.

| Element | Size | Line Height | Weight | Letter Spacing |
| --------- | ------ | ------------- | -------- | ---------------- |
| **H1** | 48px | 56px | 700 / Bold | -0.02em |
| **H2** | 40px | 48px | 700 / Bold | -0.01em |
| **H3** | 24px | 32px | 600 / Semi | 0 |
| **H4** | 20px | 28px | 600 / Semi | 0 |
| **Body (lg)** | 18px | 28px | 400 / Regular | 0 |
| **Body (md)** | 16px | 24px | 400 / Regular | 0 |
| **Body (sm)** | 14px | 20px | 400 / Regular | 0 |
| **XSmall** | 12px | 16px | 400 / Regular | 0.05em |

## 3. Spacing Rules

Our layout rhythm is based on a structured 4px/8px base system.

- **Base Unit:** 4px
- `xs`: 4px
- `sm`: 8px
- `md`: 16px
- `lg`: 24px
- `xl`: 32px
- `2xl`: 48px
- `3xl`: 64px
- `4xl`: 96px
- `5xl`: 128px

*Use 16px to 24px gaps for internal component layout (e.g., forms or cards) and 64px to 128px for section margins.*

## 4. Component Styles

### Glassmorphism Panels

Used for all major dashboard widgets, modals, and container backgrounds.

- **Background:** `rgba(255, 255, 255, 0.03)` or `rgba(10, 10, 10, 0.6)`
- **Backdrop Filter:** `blur(12px)`
- **Border:** `1px solid rgba(255, 255, 255, 0.08)`
- **Border Radius:** `12px` or `16px` (`--radius-md` or `--radius-lg`)
- **Box Shadow:** `0 4px 30px rgba(0, 0, 0, 0.5)`

### Glowing Active States

Interactive elements should feel highly responsive to user interaction.

- **Neon Red Accent:** When an item is active, selected, or hovered, use `#E74C3C`.
- **Glow Effect (Box Shadow):** `0 0 12px rgba(231, 76, 60, 0.5)`
- **Text Glow:** `0 0 8px rgba(231, 76, 60, 0.6)`
- **Transitions:** `all 0.3s cubic-bezier(0.4, 0, 0.2, 1)`

### Buttons

- **Primary Action (Solid Neon):**
  - Background: `#E74C3C`
  - Text: `#FFFFFF`
  - Border: None
  - Hover: Background brightness increased by 10%, plus glowing box-shadow `0 0 16px rgba(231, 76, 60, 0.6)`

- **Secondary Action (Ghost/Outline):**
  - Background: Transparent
  - Text: `#E74C3C`
  - Border: `1px solid #E74C3C`
  - Hover: Background `rgba(231, 76, 60, 0.1)`, glow box-shadow

### Inputs & Form Fields

- **Background:** `rgba(255, 255, 255, 0.03)`
- **Border:** `1px solid rgba(255, 255, 255, 0.1)`
- **Focus:** Border changes to `#E74C3C` with a subtle `0 0 0 2px rgba(231, 76, 60, 0.2)` ring.
- **Text:** `#FFFFFF`
- **Placeholder:** `rgba(255, 255, 255, 0.4)`

## 5. Animation Details

- **Micro-interactions:** 200ms ease-out (e.g., hovers, active states).
- **Layout shifts:** 300ms cubic-bezier(0.4, 0, 0.2, 1).
- **Page loads/Widget entries:** Slight fade-in and slide-up (e.g., `transform: translateY(10px)` to `0`, opacity `0` to `1`).

## Implementation Notes

Whenever building a new component:

1. Wrap interactive elements with the 0.3s transition timings.
2. Rely heavily on the deep dark base `#0A0A0A` for main application background to make the `#E74C3C` neon and glass panels pop.
3. Keep gradients to a minimal, preserving a sharp, technical, dashboard look.

## 6. Data Visualization & AI Infographics

When rendering charts or data visualizations (e.g., `DATA_CHART` type using Recharts):

- **Layering & Z-Index:** Always wrap the main chart container with Tailwind's `isolate` and `relative z-10` to establish a new stacking context. This PREVENTS chart SVG elements from overlapping or bleeding into text layers.
- **Data Colors:** STRICTLY use `#333333` (Dark Gray) for "Old/Manual/Competitor" metrics, and Neon Red `#E74C3C` for "CargoNex/Optimized" metrics to create a stark, immediate contrast.
- **Clean UI (No Clutter):** Disable all background grids. Use `axisLine={false}` and `tickLine={false}` on axes.
- **Tooltips:** Tooltip cursors must be `transparent` or subtle `rgba(255,255,255,0.05)`. Backgrounds must be `#111111` with no bright borders.

---

## 7. Hybrid Premium — Quote Delivery System (PDF + Web Quote Page)

**Approved:** 2026-06-15. This is the design language for all customer-facing quote outputs — the generated PDF (`buildPrintHtml()`) and the web quote page (`quote-template-v1.html`).

### Design Philosophy

White-background, high-contrast, conversion-optimized. Borrows visual weight from fintech/legal SaaS (Stripe, Notion, DocuSign). Feels like a €10M product. No dark mode, no glass effects in this context.

### Color Tokens — Quote System

| Token | Value | Usage |
|---|---|---|
| `--red` | `#C0392B` | Top bar, sec-labels, accent borders, totals, expiry |
| `--red-light` | `rgba(180,30,20,0.055)` | Watermark tint |
| `--green` | `#1a7a45` | Signed badge, monthly badge, sig-box-signed text |
| `--green-bg` | `#F0FBF4` | Signed badge bg, monthly badge bg, sig-box-signed bg |
| `--green-border` | `#B2E4C7` | Signed badge border, monthly badge border, sig-box-signed border |
| `--text-primary` | `#111` | Headings, names, amounts |
| `--text-secondary` | `#555–#666` | Body text, descriptions |
| `--text-muted` | `#aaa–#bbb` | Labels, sub-text, footer |
| `--border` | `#e8e8e8` | All dividers, card borders |
| `--surface` | `#f8f8f8` | Section backgrounds, card fills |

### Structural Rules — PDF

- **Top bar:** `<div class="pdf-top-bar">` — 3px solid `#C0392B`, full-width, first element in body
- **Watermark:** Fixed, rotated −35°, font-size 96px, color `rgba(180,30,20,0.055)`, z-index 0
- **Header:** Logo left (height 56px) + `CARGONEX` text mark above it, quote ID right (26px bold)
- **Client block:** 4-column grid (לקוח | חותם·תפקיד | הנפקה | תוקף), separated by 0.5px borders
- **Section labels (`sec-label`):** 9px, uppercase, `#C0392B`, letter-spacing 0.08em
- **Pain rows:** No icon box — right border 3px `#C0392B` (primary) or `#ddd` (secondary)
- **Benefit cards:** 2-column grid (`ben-grid`), `#f8f8f8` background, 8px radius
- **Price total:** Inside `.price-table` container, `#f8f8f8` background, amount in `#C0392B`
- **Sig block (client, signed):** `sig-box-signed` class — `#F8FEF9` bg, `#B2E4C7` border, green label
- **Sig block (CargoNex):** Plain `sig-box` — blank until CS (Counter-Signature) flow is built
- **Next steps:** Flex row with ✅ icon + text block (title + body)
- **Footer:** Centered, 9px, `#bbb`, legal line + email + signature ID

### Phase Status

| Surface | Status | Notes |
|---|---|---|
| PDF (`buildPrintHtml()`) | ✅ Done (2026-06-15) | Hybrid Premium CSS + HTML fully applied |
| Web (`quote-template-v1.html`) | 🔜 Phase 2 | CSS overhaul only — all JS must remain untouched |

### Web Quote Page — Phase 2 Rules

When overhauling `quote-template-v1.html`:
- Replace dark palette (`#080808`, glass cards) with white + Hybrid Premium tokens
- Keep ALL JS intact — do not rename or remove any element IDs or class names used by JS
- JS hooks to preserve: `sigCanvas`, `signerName`, `signerEmail`, `signerPhone`, `signerRole`, `agreeCheck`, `submitBtn`, `.pain-item`, `.pain-title`, `.pain-desc`, `.benefit-card`, `.benefit-title`, `.benefit-desc`, `.term-item`, `.hero-date-value`
- Replace glass cards with clean white cards (`border: 0.5px solid #e8e8e8; border-radius: 12px`)
- Pain items: add `border-right: 3px solid #C0392B` accent
- Benefit cards: 2-col grid matching PDF style
- Auth screen, countdown, celebration screen: keep layout, update colors only
