# Design Style Guide

## Aesthetic

The project is called **Vanilla**. This name should inform every design decision — vanilla is
the foundation, the default, the warm and welcoming base that everything else is built on.

Ice cream parlor — warm, friendly, nostalgic, and approachable. Think soft pastels, rounded
shapes, and the feeling of a sunny afternoon with a scoop in hand. Avoid anything cold,
corporate, or sharp-edged. The vibe is playful but not chaotic.

---

## Color Palette

Use CSS custom properties for all colors. Never hardcode hex values outside of `:root`.

```css
:root {
  /* Brand pastels */
  --color-vanilla:    #FFFDD0; /* lightest yellow — ideal for page backgrounds */
  --color-pistachio:  #F5F5DC; /* soft sage — section backgrounds, cards */
  --color-peach:      #FAEBD7; /* antique white peach — content areas */
  --color-mango:      #FFE4C4; /* bisque orange — highlights, hover states */
  --color-cornsilk:   #FFF8DC; /* warm cream — alternate backgrounds */

  /* Text & structure (NOT in the palette image — required additions) */
  --color-text:       #4A3728; /* warm dark brown — all body text */
  --color-text-light: #7A5C4A; /* medium brown — secondary text, captions */
  --color-accent:     #E8698A; /* strawberry pink — CTAs, links, highlights */
  --color-accent-alt: #6BAF92; /* mint green — secondary accent, success states */
  --color-border:     #E8D5C0; /* soft warm gray — dividers, input borders */
}
```

**Usage guidelines:**
- **`--color-cornsilk` (#FFF8DC) is the page background.** Use it for all large surface areas:
  page backgrounds, hero sections, headers, footers. When in doubt, reach for cornsilk first.
- **`--color-vanilla` (#FFFDD0) is used via the near-white `#FAFAF8` for card surfaces** — giving
  cards a clean lift off the cornsilk background.
- Use `--color-pistachio` and `--color-peach` sparingly — for cards, sidebars, or sections
  that need contrast against the vanilla background
- Use `--color-mango` for hover states and subtle highlights
- Use `--color-accent` (strawberry) for primary buttons, links, and CTAs
- Use `--color-accent-alt` (mint) sparingly as a complementary accent
- NEVER use pure white (`#ffffff`) or pure black (`#000000`) — always use palette colors

---

## Typography

Import from Google Fonts:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Pacifico&family=Fredoka:wght@400;500;600&family=Nunito:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap" rel="stylesheet">
```

```css
:root {
  --font-display: 'Pacifico', cursive;       /* logo, hero headlines, special callouts */
  --font-heading: 'Fredoka', sans-serif;     /* section headings, card titles, nav */
  --font-body:    'Nunito', sans-serif;      /* all body text, UI labels, paragraphs */
}
```

**Font roles:**
- **Pacifico** — retro script feel, use ONLY for the largest display text (hero, logo, section
  splash text). Use sparingly — it loses impact if overused.
- **Fredoka** — rounded, friendly, highly legible. Use for H1–H3, navigation, buttons, and
  any UI element that needs personality without being decorative.
- **Nunito** — rounded sans-serif, excellent readability. Use for all body copy, captions,
  form labels, and small text. Slightly italic works well for quotes or callouts.

**Scale:**
```css
--text-xs:   0.75rem;
--text-sm:   0.875rem;
--text-base: 1rem;
--text-lg:   1.125rem;
--text-xl:   1.25rem;
--text-2xl:  1.5rem;
--text-3xl:  2rem;
--text-4xl:  2.75rem;   /* Fredoka headings */
--text-hero: 4rem;      /* Pacifico display only */
```

---

## Shape & Spacing

- **Border radius:** Prefer rounded corners everywhere. Use `border-radius: 1rem` or higher
  for cards and containers; `border-radius: 9999px` for buttons and pills.
- **Shadows:** Soft, warm-toned shadows only. Example: `box-shadow: 0 4px 20px rgba(74, 55, 40, 0.1)`
- **Spacing:** Generous whitespace. Don't crowd elements — let the pastels breathe.

---

## What to AVOID

- Sharp corners and hard edges
- Cold color tones (blues, grays, pure whites)
- Heavy drop shadows or dramatic contrast
- Generic sans-serifs: Inter, Roboto, Arial, system-ui
- Purple gradients or "tech startup" aesthetics
- Flat, corporate button styles — buttons should feel soft and inviting
