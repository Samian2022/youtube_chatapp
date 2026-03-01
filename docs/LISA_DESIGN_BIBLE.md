# LISA — Creative Design & Implementation Prompt

> **This document is the soul of the app. Every screen, every hover, every pixel must obey it. Upload this to Cursor as the design bible. Do not deviate.**

---

## THE STORY

Lisa isn't a chatbot. She's a **private intelligence analyst** who lives inside a dark, beautiful terminal that belongs to you. She speaks in clean data and sharp insight. Her world is midnight blue, brushed gold, and warm candlelight. When you open this app, you should feel like you just walked into a private members-only library where the smartest person in the room is waiting for your question.

This is **not** a Silicon Valley SaaS product. This is not Slack. This is not ChatGPT's cousin. This is a **bespoke instrument** — designed like a Leica camera, coded like a Swiss watch, styled like a Tom Ford store at midnight.

**Design DNA:**
- The sophistication of a Bloomberg terminal
- The editorial beauty of a Monocle magazine spread
- The dark warmth of a whisky bar in Tokyo's Ginza district
- The precision of Dieter Rams, the drama of Saul Bass

---

## CREATIVE DIRECTION: "MIDNIGHT FOLIO"

### The Visual Concept

Imagine a folio — a beautifully bound leather portfolio — opened flat on a desk under a brass desk lamp. The left page is your table of contents (sidebar). The right page is where you write and receive responses (chat). The gold clasp of the folio is the accent color. The cream paper edge peeks through in text color. The lamp casts a warm glow that creates soft vignettes in the corners.

Now make that digital. That's Lisa.

---

## COLOR ARCHITECTURE

Not a "palette." An **architecture** — colors have roles, hierarchy, and spatial meaning.

```css
:root {
  /* THE ROOM — Surface layers (darkest to lightest) */
  --void:             #08080A;
  --room:             #0E0E12;
  --desk:             #151519;
  --paper:            #1C1C22;
  --paper-fold:       #24242B;
  --paper-edge:       #2E2E37;
  
  /* THE LAMP — Light & accent system */
  --lamp:             #C8A44E;
  --lamp-dim:         #9A7B36;
  --lamp-bright:      #E2C366;
  --lamp-glow:        rgba(200, 164, 78, 0.07);
  --lamp-ember:       rgba(200, 164, 78, 0.03);
  
  /* THE INK — Text hierarchy */
  --ink:              #E4E0D8;
  --ink-faded:        #A09C94;
  --ink-ghost:        #635F58;
  --ink-trace:        #3D3A35;
  --ink-invisible:    #2A2825;
  
  /* THE BINDING — Structural lines */
  --binding:          rgba(255, 255, 255, 0.05);
  --binding-strong:   rgba(255, 255, 255, 0.09);
  --binding-gold:     rgba(200, 164, 78, 0.15);
  
  /* SIGNALS — Semantic color */
  --signal-go:        #34D399;
  --signal-wait:      #FBBF24;
  --signal-stop:      #F87171;
  --signal-note:      #60A5FA;
  
  /* DEPTH — Shadow vocabulary */
  --depth-shallow:    0 1px 3px rgba(0,0,0,0.4);
  --depth-medium:     0 4px 20px rgba(0,0,0,0.45), 0 1px 6px rgba(0,0,0,0.3);
  --depth-deep:       0 16px 64px rgba(0,0,0,0.55), 0 4px 16px rgba(0,0,0,0.3);
  --depth-abyss:      0 32px 100px rgba(0,0,0,0.7);
  --depth-inner:      inset 0 1px 0 rgba(255,255,255,0.025);
  --depth-lamp:       0 0 30px rgba(200,164,78,0.06), 0 0 80px rgba(200,164,78,0.03);
}
```

---

## TYPOGRAPHY

| Role | Typeface | Notes |
|------|----------|-------|
| **Display** | Cormorant Garamond (Google Fonts) | Weight 300, 400. Never bold. |
| **Body / UI** | Satoshi (Fontshare CDN) | Fallback: DM Sans, system-ui |
| **Mono** | IBM Plex Mono (Google Fonts) | Weight 400 |

```css
--font-display:   'Cormorant Garamond', 'Garamond', 'Georgia', serif;
--font-body:      'Satoshi', 'DM Sans', -apple-system, system-ui, sans-serif;
--font-mono:      'IBM Plex Mono', 'SF Mono', 'Consolas', monospace;

/* Size Scale (rem) */
--size-micro:   0.625rem;
--size-2xs:     0.6875rem;
--size-xs:      0.75rem;
--size-sm:      0.8125rem;
--size-base:    0.9375rem;
--size-md:      1.0625rem;
--size-lg:      1.25rem;
--size-xl:      1.625rem;
--size-2xl:     2.25rem;
--size-hero:    3.25rem;

--leading-tight:    1.2;
--leading-snug:     1.4;
--leading-normal:   1.6;
--leading-relaxed:  1.75;
--tracking-tightest: -0.04em;
--tracking-tight:    -0.02em;
--tracking-normal:   0;
--tracking-wide:     0.05em;
--tracking-widest:   0.12em;
```

---

## TEXTURE & ATMOSPHERE

### 1. Film Grain Overlay (Global)
```css
body::before {
  content: '';
  position: fixed;
  inset: 0;
  z-index: 10000;
  pointer-events: none;
  opacity: 0.018;
  background: url("data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  mix-blend-mode: overlay;
}
```

### 2. Vignette Corners
```css
body::after {
  content: '';
  position: fixed;
  inset: 0;
  z-index: 9999;
  pointer-events: none;
  background: radial-gradient(ellipse at 50% 40%, transparent 50%, rgba(0,0,0,0.25) 100%);
}
```

### 3. Ambient Lamp
```css
.ambient-lamp {
  position: fixed;
  z-index: 0;
  pointer-events: none;
  top: -15%;
  right: 10%;
  width: 900px;
  height: 900px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(200,164,78,0.045) 0%, rgba(200,164,78,0.015) 35%, transparent 70%);
  filter: blur(60px);
}
```

### 4. Gold Focus Ring
```css
.focus-gold:focus-visible {
  outline: none;
  box-shadow: 0 0 0 1.5px var(--lamp-dim), 0 0 12px var(--lamp-glow), 0 0 30px var(--lamp-ember);
}
```

---

## LAYOUT

- **Sidebar: 264px.** bg: var(--desk). Right edge: 1px solid var(--binding).
- **Main:** bg: var(--room). Content well: max-width 740px, margin 0 auto, padding 0 28px.
- **No top header bar.** Session title scrolls with content.

---

## GOLDEN THREAD — When to use gold

- Brand: 28px gold foil line under "Chat"
- Lisa's avatar (gold gradient + star)
- Lisa's name in messages ("LISA" in gold)
- Focus rings on inputs
- Send button (solid gold)
- New Chat hover, suggestion chip hover
- Active session (gold left bar)
- Chart line, tooltip value, peak stat, code keywords
- Progress bar fill, streaming dots
- Auth submit, Fetch Data, Download JSON hover

---

## RED LINES — Never do

1. Chat bubbles (no colored/rounded message bubbles)
2. Pure white (#FFF) — max #E4E0D8
3. Inter, Roboto, Arial as visible fonts
4. Purple, violet, magenta, pink
5. border-radius > 14px on containers
6. Gradient backgrounds on large surfaces (except avatar, lamp, buttons)
7. Bold 700+ in body text — max 600
8. Emoji in UI chrome — Lucide icons only
9. Animations > 300ms (except lamp 3s, shimmer 1.8s)
10. Material/Chakra/Ant/Bootstrap — custom or shadcn restyled
11. Stock loading spinners — use skeleton or gold dot pulse
12. Underlined links by default — underline on hover only

---

## FILE STRUCTURE (target)

```
src/styles/
  tokens.css         ← All CSS custom properties (Midnight Folio)
  reset.css          ← Minimal reset + scrollbar
  typography.css     ← Font imports + type utilities
  effects.css        ← Grain, vignette, ambient lamp
  syntax-midnight-gold.css
```

---

*When someone opens this app, they shouldn't think "Oh, another chat interface." They should think: "Whoever made this gives a damn."*

**Build it like that.**
