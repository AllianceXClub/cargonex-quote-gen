# CargoNex — System PDF Design Guide
**גרסה:** 1.2  
**תאריך:** 25 יוני 2026  
**נושא הניתוח:** `buildPrintHtml` ב-`pdf-generator/index.js` — ה-PDF שהמערכת מייצרת  
**רפרנס:** CargoNex-STB-Proposal-v2.pdf (הצעה ידנית של אבי — הרף שצריך להגיע אליו ולעבור אותו)  
**כלי ביצוע:** עריכת CSS בתוך `buildPrintHtml` ב-index.js  

> **מה השתנה מ-v1.0:** הניתוח עכשיו מוכוון למוצר הדיגיטלי (PDF מערכת), לא לדוקומנט ידני.

---

## מפת המסמך שהמערכת מייצרת כיום

```
┌─ Top Bar (3px אדום) ──────────────────────────────────────────┐
│  Header: [לוגו + badge נחתם]           [מספר הצעה 26px]      │
├─ Client Block (4 עמודות) ─────────────────────────────────────┤
│  לקוח | חותם + תפקיד | תאריך הנפקה | תוקף עד (אדום)          │
├─ Section: האתגר שלכם ─────────────────────────────────────────┤
│  pain-rows עם גבול שמאל אדום/אפור                             │
├─ Section: הפתרון שלנו ────────────────────────────────────────┤
│  ben-grid (2 עמודות, כרטיסי #f8f8f8)                         │
├─ Section: ההצעה הכספית ───────────────────────────────────────┤
│  price-table: הטמעה + רישוי + סה"כ שנתי (אדום 22px)          │
├─ Section: תנאי ההתקשרות ──────────────────────────────────────┤
│  term-rows (border סביב + הדגשת סעיף ראשון)                  │
├─ Sig Section ─────────────────────────────────────────────────┤
│  sig-cols (1fr 1fr): לקוח (חתום) | CargoNex (ממתין/חתום)     │
├─ Next Steps (ירוק #f8f8f8) ──────────────────────────────────┤
│  ✅ "מה קורה עכשיו?" + מייל קשר                               │
└─ Footer (9px אפור, טקסט חוקי + signature_id) ────────────────┘
```

---

## חלק 1 — Brand Review: מצב נוכחי vs. רפרנס

### מה עובד טוב (לשמור)

| רכיב | למה עובד |
|------|----------|
| `pdf-top-bar` 3px אדום | עוגן ויזואלי חזק, מזהה את CargoNex מיד |
| `signed-badge` (גלולה ירוקה) | אות אמון מיידי, UX לגיטימי לחתימה אלקטרונית |
| גופן Heebo | ה-RTL Hebrew font הטוב ביותר הקיים. אל תחליפו. |
| `watermark` "נחתם" / "נחתם ואושר" | גורם להצעה לנראות כמסמך רשמי — מוסיף אמינות |
| `pain-row` עם גבול שמאל אדום | הייררכיה ויזואלית נכונה בין pain ראשי לשניוני |
| `price-total` בלבד בצבע אדום 22px | מדגיש את ההתחייבות השנתית ב"נקודת הכאב" הנכונה |
| `sig-box-signed` (background ירוק) | בידול ברור בין "חתום" לבין "ממתין" |

---

### ממצאים לשיפור

| # | בעיה | מיקום בקוד | חומרה |
|---|------|------------|--------|
| 1 | גבול שמאל אדום רק ב-pain — benefit cards חסרות accent | `.ben-card` CSS | 🔴 גבוה |
| 2 | "Custom Setup" / "Monthly MRR" — אנגלית בצד Hebrew | `price-sub` hardcoded text | 🔴 גבוה |
| 3 | Pending CargoNex box — 4 שורות ריקות (blankLine×4) | sig-box CargoNex | 🟡 בינוני |
| 4 | `sec-label` בגודל 9px — קטן מדי, בקושי נקרא בהדפסה | `.sec-label` CSS | 🟡 בינוני |
| 5 | אדום משמש 4 מטרות שונות בו-זמנית | צבעי הטוקן | 🟡 בינוני |
| 6 | קפיצות טיפוגרפיה קטנות (9px → 11px → 13px → 17px) | סקאלת גופנים | 🟡 בינוני |
| 7 | `pain-row-secondary` — אפור בלבד, לא מספיק ויזואלית | `.pain-row-secondary` | 🟠 נמוך |
| 8 | `watermark` opacity נמוכה (0.055) — נעלמת בהדפסה | `.watermark` CSS | 🟠 נמוך |
| 9 | `pain-desc` בצבע `#666` — קשה לקריאה בהדפסה | `.pain-desc` CSS | 🟠 נמוך |
| 10 | Next Steps block — נראה כ-afterthought, לא כ-close | `.next-steps` CSS | 🟠 נמוך |
| 11 | Footer לא מדפיס בצורה עקבית בכל הדפסות | `.pdf-footer` CSS | 🟠 נמוך |

---

## חלק 2 — UX Copy: טקסט שהמערכת מדפיסה

### תוויות שצריך לשנות (hardcoded בקוד)

| קיים | מוצע | מיקום בקוד |
|------|-------|------------|
| `"Custom Setup"` (price-sub) | `"הקמה חד-פעמית"` | `buildPrintHtml` line ~510 |
| `"Monthly MRR"` (price-sub) | `"מנוי חודשי"` | `buildPrintHtml` line ~516 |
| `"האתגר שלכם"` (sec-label) | `"האתגר"` | קצר יותר, טוב יותר |
| `"הפתרון שלנו"` (sec-label) | `"הפתרון"` | |
| `"ממתין לאישור CargoNex"` | `"ממתין לאישור"` | מיותר לכתוב "CargoNex" שוב |
| `"נציג מטעמינו ייצור עימכם קשר בהקדם."` | `"נציג מטעמנו יפנה אליכם תוך יום עסקים."` | מחויב, לא עמום |
| `"חתימות מורשים"` (sec-label) | `"אישור הצדדים"` | פחות בירוקרטי |

### טקסט שעובד טוב — אל תשנו

- `"✓ ההסכם אושר — שני הצדדים חתמו"` — מושלם
- `"מסמך זה נחתם אלקטרונית בהתאם לחוק חתימה אלקטרונית, התשס"א-2001"` — נשאר
- `"תוקף עד"` עם `class="expiry"` (צבע אדום) — נשאר

---

## חלק 3 — Design System: טוקנים מוגדרים

> **אלה הטוקנים שה-CSS ב-`buildPrintHtml` כבר משתמש בהם (או צריך להשתמש)**

### צבעים — מצב רצוי לעומת קיים

| שם הטוקן | HEX | שימוש נכון | שימוש שגוי כיום |
|----------|-----|-----------|-----------------|
| `brand-red` | `#C0392B` | top-bar, sec-label, signed-badge border, primary pain border, expiry | גם ב-total price (מבלבל) |
| `price-emphasis` | `#111111` | total price amount | כיום `#C0392B` — יש לשנות |
| `text-primary` | `#111111` | כותרות, שמות | ✅ נכון |
| `text-secondary` | `#555555` | pain-desc, term-text | כיום `#666` — קשה לקריאה |
| `text-muted` | `#999999` | labels, price-vat | כיום `#aaa` = `#aaa` ✅ |
| `surface-card` | `#f8f8f8` | ben-card, price-header, next-steps | ✅ נכון |
| `border-light` | `#e8e8e8` | הפרדות, borders | ✅ נכון |
| `signed-green` | `#1a7a45` | signed state text | ✅ נכון |
| `signed-green-bg` | `#F0FBF4` | sig-box-signed, signed-badge | ✅ נכון |
| `signed-green-border` | `#B2E4C7` | signed-badge, sig-box | ✅ נכון |

**כלל צבע חדש:**
- אדום = Brand + אזהרה (תוקף, גבול pain ראשי, top-bar)
- כהה = ערכים חשובים (total price)
- ירוק = מצבי הצלחה/חתימה

---

### טיפוגרפיה — סקאלה מוצעת

| שם | גודל כיום | גודל מוצע | שימוש |
|----|----------|-----------|--------|
| `quote-id` | 26px Bold | 24px Bold | מספר הצעה |
| `sec-title` | 17px Bold | 16px Bold | כותרת סעיף |
| `sec-label` | 9px Bold | **10px Bold** | label מעל sec-title |
| `pain-title` | 13px Bold | 13px Bold | ✅ אין שינוי |
| `body-copy` | 11px | **11.5px** | pain-desc, term-text |
| `price-name` | 13px Bold | 13px Bold | ✅ |
| `price-amount-row` | 14px Bold | 14px Bold | ✅ |
| `price-total-amount` | 22px Bold | **20px Bold** | סה"כ שנתי |
| `meta-label` | 9px | **10px** | labels ב-client-block |
| `meta-value` | 12px Bold | 12px Bold | ✅ |

---

## חלק 4 — Design Handoff: שינויים קונקרטיים בקוד

> כל שינוי ממוין לפי עדיפות ומכיל קוד מוכן.

---

### 🔴 עדיפות ראשונה — 15 דקות עבודה

**#1 — תרגם את ה-"Custom Setup" / "Monthly MRR" לעברית**

מחפש בקוד:
```javascript
// שורות ~510-518 בbuildPrintHtml
```

**לפני:**
```html
<div><div class="price-name">הטמעה מקוסטמת</div><div class="price-sub">Custom Setup</div></div>
...
<div><div class="price-name">תשתית + רישוי SaaS</div><div class="price-sub">Monthly MRR</div></div>
```

**אחרי:**
```html
<div><div class="price-name">הקמה מותאמת</div><div class="price-sub">חד-פעמי, כולל אינטגרציות</div></div>
...
<div><div class="price-name">מנוי ענן + רישוי</div><div class="price-sub">שירות שוטף, SLA כלול</div></div>
```

---

**#2 — שנה total price מאדום לכהה**

מחפש בCSS בתוך ה-template string:
```
.total-amount
```

**לפני:**
```css
.total-amount{font-size:22px;font-weight:700;color:#C0392B;text-align:left;}
```

**אחרי:**
```css
.total-amount{font-size:20px;font-weight:700;color:#111;text-align:left;}
```

> רציונל: אדום = אזהרה/brand. הסכום השנתי הוא ערך נייטרלי, לא אזהרה.

---

**#3 — הגדל sec-label מ-9px ל-10px ושפר קריאות**

**לפני:**
```css
.sec-label{font-size:9px;color:#C0392B;letter-spacing:0.08em;margin-bottom:10px;font-weight:700;}
```

**אחרי:**
```css
.sec-label{font-size:10px;color:#C0392B;letter-spacing:0.06em;margin-bottom:8px;font-weight:700;text-transform:uppercase;}
```

---

### 🟡 עדיפות שנייה — 30 דקות עבודה

**#4 — הוסף accent ל-benefit cards (כמו pain-row)**

**לפני:**
```css
.ben-card{background:#f8f8f8;border-radius:8px;padding:12px 14px;page-break-inside:avoid;}
```

**אחרי:**
```css
.ben-card{background:#f8f8f8;border-radius:8px;padding:12px 14px;page-break-inside:avoid;border-right:3px solid #e0e0e0;}
```

> רציונל: pain-rows יש להם גבול שמאל (RTL: ימין בהצגה) — benefit cards צריכות accent עקבי. לא אדום (כי הם חיוביים) — אפור נייטרלי.

---

**#5 — שפר את "pending" CargoNex box**

כיום: 4 שורות ריקות (`blankLine`) כשCargoNex עוד לא חתם.

**מחפש בקוד** (סביב שורה ~548):
```javascript
${countersigned
  ? `...חתימה...`
  : `${blankLine("שם מלא")}${blankLine("תפקיד")}${blankLine("חתימה")}${blankLine("תאריך")}`}
```

**מחליף ל:**
```javascript
${countersigned
  ? `<div class="sig-name">${esc(countersigner_name)}</div>
     ${countersigner_role ? `<div class="sig-role">${esc(countersigner_role)}</div>` : ""}
     <div class="sig-date">${esc(countersigned_at)}</div>`
  : `<div style="margin:20px 0;padding:14px;background:#fafafa;border:1.5px dashed #ddd;border-radius:8px;">
       <div style="font-size:11px;color:#aaa;text-align:center;line-height:1.6;">
         ⏳<br/>ממתין לחתימת CargoNex
       </div>
     </div>`}
```

---

**#6 — שפר pain-desc לקריאה טובה יותר בהדפסה**

**לפני:**
```css
.pain-desc{font-size:11px;color:#666;line-height:1.6;}
```

**אחרי:**
```css
.pain-desc{font-size:11px;color:#555;line-height:1.65;}
```

---

**#7 — הגבר watermark מעט**

**לפני:**
```css
.watermark{...color:rgba(180,30,20,0.055);...}
```

**אחרי:**
```css
.watermark{...color:rgba(180,30,20,0.085);...}
```

---

### 🟢 עדיפות שלישית — 15 דקות עבודה

**#8 — עדכן טקסטים hardcoded**

```javascript
// מחפש: "נציג מטעמינו ייצור עימכם קשר בהקדם."
// מחליף: "נציג מטעמנו יפנה אליכם תוך יום עסקים."

// מחפש: "חתימות מורשים"
// מחליף: "אישור הצדדים"

// מחפש: "ממתין לאישור CargoNex"
// מחליף: "ממתין לאישור"
```

---

**#9 — שפר next-steps לנראות premium**

**לפני:**
```css
.next-steps{padding:14px 28px;background:#f8f8f8;border-top:0.5px solid #e8e8e8;...}
```

**אחרי:**
```css
.next-steps{padding:16px 28px;background:#F0FBF4;border-top:0.5px solid #B2E4C7;...}
```

> שינוי הרקע מ-gray ל-green-light מחבר ויזואלית את ה-next-steps לסטטוס "חתום" (כמו signed-badge).

---

**#10 — תקן meta-label מ-9px ל-10px**

**לפני:**
```css
.meta-item label{font-size:9px;color:#aaa;...}
```

**אחרי:**
```css
.meta-item label{font-size:10px;color:#999;...}
```

---

## חלק 5 — Gap Analysis: מערכת vs. רפרנס STB

> השוואה בין ה-PDF שהמערכת מייצרת לרפרנס של אבי

| ממד עיצובי | STB (רפרנס ידני) | מערכת (נוכחי) | פער |
|------------|-----------------|---------------|-----|
| Visual hierarchy | ✅ סעיפים ברורים עם מספור | ✅ Sec-label + sec-title | כמעט שווה |
| Brand anchoring | ✅ לוגו + קו אדום | ✅ Top-bar + לוגו | שווה |
| RTL typography | ✅ Heebo, RTL נקי | ✅ Heebo, RTL נקי | שווה |
| Pricing presentation | ✅ Price boxes עם badge | ✅ Table עם badge | מערכת עדיפה (טבלה יותר ברורה) |
| Signature block | ✅ 3 עמודות (date/client/CargoNex) | ⚠️ 2 עמודות, pending כ-4 שורות ריקות | STB עדיפה |
| Legal authenticity | ❌ אין watermark, אין signature ID | ✅ watermark + חוק חתימה + sig ID | **מערכת מנצחת** |
| Next steps | ❌ לא קיים | ✅ "מה קורה עכשיו?" | **מערכת מנצחת** |
| Benefit framing | ❌ feature list גרוע | ✅ pains + benefits separated | **מערכת מנצחת** |
| English terms | ✅ מינימלי | ❌ "Custom Setup", "Monthly MRR" | STB עדיפה |
| Color semantics | ✅ אדום = brand בלבד | ⚠️ אדום = brand + total price | STB עדיפה |

**מסקנה:** המערכת כבר עולה על הרפרנס הידני ב-3 ממדים קריטיים. תיקון 10 הנקודות מעלה תבקש מה-STB proposal.

---

## חלק 6 — CSS Quick-Reference לביצוע

> רשימת כל השינויים יחד — ניתן לפייסט ישירות לתוך ה-template string ב-buildPrintHtml

```css
/* === PRIORITY 1 === */
.total-amount{font-size:20px;font-weight:700;color:#111;text-align:left;}
.sec-label{font-size:10px;color:#C0392B;letter-spacing:0.06em;margin-bottom:8px;font-weight:700;text-transform:uppercase;}

/* === PRIORITY 2 === */
.ben-card{background:#f8f8f8;border-radius:8px;padding:12px 14px;page-break-inside:avoid;border-right:3px solid #e0e0e0;}
.pain-desc{font-size:11px;color:#555;line-height:1.65;}
.watermark{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-35deg);font-size:96px;font-weight:900;color:rgba(180,30,20,0.085);pointer-events:none;z-index:0;white-space:nowrap;letter-spacing:0.1em;}

/* === PRIORITY 3 === */
.next-steps{padding:16px 28px;background:#F0FBF4;border-top:0.5px solid #B2E4C7;page-break-inside:avoid;position:relative;z-index:1;display:flex;align-items:flex-start;gap:10px;}
.next-steps-icon{font-size:15px;color:#1a7a45;flex-shrink:0;margin-top:1px;}
.meta-item label{font-size:10px;color:#999;display:block;margin-bottom:3px;letter-spacing:0.04em;}
```

---

## תיקוני עיצוב v1.2 (25 יוני 2026)

### שינוי #A — מספר הצעה: הקטנת פונט

**מה:** `.pdf-meta-id` מ-26px ל-16px — כך שלא ידומינה על הלוגו.

**בקוד CSS (buildPrintHtml):**
```css
/* לפני */
.pdf-meta-id{font-size:26px;font-weight:700;color:#111;line-height:1;letter-spacing:-0.02em;}

/* אחרי */
.pdf-meta-id{font-size:16px;font-weight:600;color:#555;line-height:1;letter-spacing:0;}
```

---

### שינוי #B — שורת "תשתית + רישוי": שמירת הכותרת המקורית

**מה:** שמירה על "תשתית + רישוי SaaS" כשם הכתוב בחוזה. רק ה-sub-text משתנה.

```html
<!-- שומרים את שם השירות הראשי -->
<div class="price-name">תשתית + רישוי SaaS</div>
<!-- משנים רק את sub-text -->
<div class="price-sub">שירות שוטף, SLA כלול</div>
```

---

### שינוי #C — בלוקי חתימה: גבולות ב-BOLD + טקסט BOLD

**מה:** שני צדדי החתימה (לקוח וCargoNex) מוצגים עם פרטים ידניים (לא חתימה דיגיטלית). גבולות מלבנים ותוויות — שניהם BOLD.

**עדכון CSS:**
```css
/* sig-box — גבול מודגש */
.sig-box{border:2px solid #555;border-radius:10px;padding:14px;text-align:center;page-break-inside:avoid;}

/* sig-box-label — BOLD */
.sig-box-label{font-size:10px;color:#333;font-weight:700;margin-bottom:10px;letter-spacing:0.07em;}
```

**עדכון blankLine function:**
```javascript
const blankLine = (label) =>
  `<div style="margin:10px 0 2px;">
    <div style="border-bottom:2px solid #444;height:28px;"></div>
    <div style="font-size:9px;font-weight:700;color:#333;text-align:center;margin-top:3px;">${label}</div>
  </div>`;
```

**עדכון HTML בשני צדדים (preview mode + awaiting countersign):**
```javascript
// הסר: sig-box-signed/countersigned styling בחתימה הידנית
// שנה ל: שני הצדדים מציגים blankLine ×4 בלבד
// אם מדובר בהצעה מודפסת: לא להדגיש sig-box-signed בירוק (כי לא קיימת עדיין חתימה)
```

---

## גרסאות ושינויים

| גרסה | תאריך | שינוי |
|-------|--------|--------|
| 1.0 | 2026-06-25 | יצירה ראשונית — ניתוח שגוי (STB ידני) |
| 1.1 | 2026-06-25 | **גרסה נכונה** — ניתוח buildPrintHtml (PDF מערכת) |
| 1.2 | 2026-06-25 | תיקוני עיצוב: quote-id קטן, שמירת "תשתית + רישוי", sig-box BOLD |

---

*PROPOSAL_DESIGN_GUIDE v1.1 — CargoNex — 2026-06-25*
