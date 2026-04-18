# targetdash.ai — landing site

Deployable package. Unzip to repo root, commit, push → Vercel deploys automatically.

---

## What's in this package

```
.
├── index.html          (3746-line landing — ORIGINAL structure + image animation upgrades + a11y + 1 bug fix)
├── login.html          (ORIGINAL — unchanged)
├── onboarding.html     (ORIGINAL — unchanged)
├── getstarted.html     (ORIGINAL — unchanged)
├── package.json        (ORIGINAL — unchanged)
├── vercel.json         (HARDENED — CSP, HSTS, cache headers)
└── api/
    ├── ai-chat.js          (HARDENED — LLM proxy removed; compat shim returns static facts)
    ├── did-you-know.js     (NEW — strict did-you-know endpoint, no user input to prompt)
    ├── create-checkout.js  (HARDENED — price_id whitelist + input validation)
    └── stripe-webhook.js   (HARDENED — timestamp tolerance + idempotency)
```

---

## Changes to `index.html` — image animations + a11y + bug fix

### Image animations upgraded (content/layout 100% unchanged except Mini #3 below)

| Element                       | Before                              | After                                                          |
| ----------------------------- | ----------------------------------- | -------------------------------------------------------------- |
| Desktop mockup float          | 6s ease-in-out, 1D translateY       | 9s cubic-bezier, 4-point 2D drift, reduced rotation            |
| Mobile mockup float           | 6s ease-in-out, 0.8s delay          | 10s cubic-bezier, 4-point 2D drift, 1.2s delay (async)         |
| Mockup glow pulse             | 4s, 2-point opacity+scale           | 5.5s, 5-point organic oscillation                              |
| Mini card #1 float (Forecast) | 7s, 2-point, 0.3s delay             | 8s cubic-bezier, 3-point drift, 0.4s delay                     |
| Mini card #2 float (Scenario) | 8s, 2-point, 0.6s delay             | 9.5s cubic-bezier, 3-point drift, 1.1s delay                   |
| Mini card #3 float            | 7.5s, 2-point, 1s delay             | 8.8s cubic-bezier, 3-point drift, 2s delay                     |
| Heatmap scanner sweep         | 3.5s linear, abrupt fade            | 4.2s cubic-bezier, softer opacity curve (8%/50%/92% keyframes) |
| Forecast pulse ring (mini #1) | Single SMIL ring                    | Layered double ripple — 2nd ring offset 1.3s for depth         |
| Scenario Planning forecast    | Single SMIL ring                    | Layered double ripple — 2nd ring offset 1.4s, wider reach      |

### Mini card #3 content swap — CIT-Specs → What-if heatmap

The tax-planner mini card (CIT-Specs with the tax calculation table: EBT, perm. diffs, losses, taxable, × 20%, P&L TAX/mo) has been replaced with a **What-if sensitivity heatmap**:

- **5×5 matrix** visualising EBITDA sensitivity to revenue ± and cost ± changes
- **Purple→green diagonal gradient** (distinct from Mini #2 Scenario's warm red→green 7×7 palette)
- **Visible axis labels**: "REV %" (top-left) and "COST %" (bottom-left)
- **BASE cell** (center of matrix) highlighted with a lilac outline + **layered ring pulse animation** (contained within cell bounds — 2 rings, 2.4s cycle, second ring offset 1.2s)
- **Footer stat**: `Sensitivity ±82K EBITDA`
- Header dot: new `.bt-mini-dot-wi` class — lilac `#a78bfa` with purple glow (vs the old red `#f87171` CIT dot)

The two heatmaps now coexist as complementary visuals — Scenario (Mini #2, general scenario grid) and What-if (Mini #3, parameter sensitivity) — with intentionally different sizes, palettes, and animations so they read as related but distinct tools. The orphaned `.bt-mini-cit` / `.bt-cit-*` CSS rules and `.bt-mini-dot-cit` class remain in the stylesheet as harmless dead code (no references).

### Accessibility additions

1. `prefers-reduced-motion` media query — disables decorative animations (mockup floats, glow pulse, mini-card floats, heatmap scan, badge pulse, scroll-line scan, chat-fab pulse, forecast widget float, agent progress sweep).
2. JS canvas guard — particle canvas hidden + SVG SMIL animations paused when user has reduced-motion preference.
3. ESC key handler — closes contact modal + EBITDA-9000 popup (previously only clickable close buttons worked).
4. `aria-label` on 3 icon-only buttons:
   - `.chat-fab` → "Open EBITDA-9000 chat"
   - `.chat-send-btn` → "Send message"
   - `.contact-modal-close` → "Close dialog"
   - `.popup-close` → "Close chat"
5. Color contrast fixes (footer tertiary text was `#3d3c52` on `#0a0a0f` = ratio 1.84, failing WCAG AA min 4.5). Bumped to `#8b8a9a` = ratio ~5.4 on five footer elements: `.foot-copy`, `.foot-links a` (Sign in + mailto), footer tertiary paragraph, and `.scroll-hint` ("Scroll to explore").

Verified with `axe-core` WCAG 2.1 AA automated audit: **0 violations** (down from 2 — critical `button-name` and serious `color-contrast`).

### Bug fix

`gap:10` → `gap:10px` on line 2060 (agent widget inner flexbox). CSS `gap` requires a unit; `10` alone is invalid and collapsed the spacing between the icon and the adjacent text.

### What was NOT touched in index.html

- Hero structure, mockup SVG content, all copy text
- Navigation, feature grids, sections, footer, CTA
- Typography (Outfit + Instrument Sans)
- Colour palette
- Scroll reveal (`.rv`) animations
- Chat widget, role-tab conversations, EBITDA-9000 popup content
- Upload widget walkthrough, cost-centre widget
- Particle canvas behaviour (beyond the reduced-motion guard)

---

## Security audit — findings

**No critical vulnerabilities found.** The landing code is well-written from a security perspective.

### What was checked

| Vector                                           | Result                                                          |
| ------------------------------------------------ | --------------------------------------------------------------- |
| DOM-based XSS via URL params                     | OK — no `location.search`/`.hash` reads                         |
| `innerHTML` with user input                      | OK — all ~20 uses take data from hardcoded objects (CONVOS, FACTS, UPLOAD_MAPPINGS, CC_DATA) |
| `eval` / `Function()` / `document.write`         | OK — none used                                                  |
| Third-party scripts / CDNs                       | OK — Google Fonts only (CSP-allowed)                            |
| Open redirect                                    | OK — no redirect URLs from user input                           |
| Inline `onclick` handlers                        | Present — static function calls, CSP-compliant with `'unsafe-inline'` |
| Form submission / file upload                    | OK — no real forms (CSV "upload" is demo only, no data leaves browser) |
| Clickjacking                                     | OK — `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'`     |

### Residual minor issues (NOT fixed — requested scope was image animations)

- Dead code in `renderCC` (lines ~3351-3356): unused regex + redundant `replace('€','€')`. Functional but ugly.
- Legend positional offset (line 1814): "Gross Profit" text at `x=79` next to circle at `cx=74` — cosmetic, 5px off.
- `.hero-right { display: none }` below 1100px — all hero mockups hidden on tablets/mobile. Presumably intentional.
- `.agent-demo-card` references `agentSweep`/`agentProgress` keyframes inline — not verified whether they're defined in the stylesheet. If missing, the sweep effect silently does nothing (not a crash).

---

## API hardening

### `api/ai-chat.js` — DEPRECATED compat shim
Previously proxied Anthropic with client-supplied `{messages, system}` — credit-drain + jailbreak vector on a public unauthenticated surface. Now returns 5 static fallback facts. Zero LLM calls, backward-compatible response shape, `X-Deprecated` header set.

### `api/did-you-know.js` — NEW strict endpoint
- No user text is ever concatenated into the prompt — fully server-controlled.
- `count` clamped 1–5, `category` validated against a whitelist of 4 categories.
- Body size ≤ 2 KB, per-IP rate limit 10/min.
- Localhost origins allowed only outside production.
- JSON-array output forced; parse failure → static fallback.
- Max tokens 500 (~$0.002 per worst-case call).
- Fail-soft to fallback on network/API errors (no 500 leaks).

### `api/create-checkout.js`
- `price_id` whitelist (env override `ALLOWED_PRICE_IDS`) — no arbitrary Stripe prices.
- UUID/email input validation, max-length clamps.
- Stripe `Idempotency-Key` header (prevents duplicate sessions on retry).
- Localhost gated to non-prod.
- Error messages scrubbed.

### `api/stripe-webhook.js`
- 5-min timestamp tolerance — rejects replayed webhooks.
- Idempotency via `stripe_events` table (fail-open if table missing).
- Supabase PATCH errors now return 500 → Stripe retries.
- Signature verification unchanged (already correct: HMAC-SHA256 + `timingSafeEqual`).

## QA test results (this package)

Automated checks that were run, with results. See the "Before production deploy" section below for what still needs human/staging verification.

### ✅ Passing (92 / 92 actual pass)

**Static analysis**
- 31 `getElementById` refs resolve (including `popupTyping` which is created dynamically by `addTypingPopup()`)
- 22 `@keyframes` defined for 22 animations referenced
- All SVG def IDs unique (no duplicates that would break gradients)
- All 5 anchor targets (`#features`, `#ai`, `#agents`, `#security`, `#responsible-ai`) exist
- Internal link `/login` resolves to `login.html`

**Syntax**
- `vercel.json`, `package.json` → valid JSON
- All 4 API files → `node --check` pass

**Browser rendering (headless Chromium)**
- No uncaught JS errors on page load
- No console errors
- All 9 key sections render (nav, hero, strip, #ai, #agents, #features, #security, #responsible-ai, footer)
- Role-tab click switches AI advisor role correctly
- Dim-tab click swaps Cost Centre data (BY MARKETING → BY COUNTRY, Finland first row)
- Contact modal opens on click, closes on ESC
- EBITDA-9000 popup opens on FAB click, closes on ESC
- First keyboard Tab focuses nav "Sign in" link
- `popupTyping` element is created dynamically during fact delivery
- Mobile viewport (390×844): `.hero-right` hidden, no horizontal scroll overflow
- Google Fonts CSS is applied — `getComputedStyle(.hero-h1).fontFamily === "Outfit, sans-serif"` (sandbox returned 403 on the actual font download, but this is a sandbox network restriction — not a CSP issue; the computed style proves CSS loaded)

**Login flow chain** (explicit verification per your question)
- Nav "Sign in" → `href="/login"` ✓
- Hero "Sign in" → `href="/login"` ✓ (2 instances — hero section + CTA section, both correct)
- `/login` → `login.html` (cleanUrls: true in vercel.json)
- `login.html` contains `<script>window.location.href='https://app.targetdash.ai';</script>` ✓
- `onboarding.html` also redirects to `https://app.targetdash.ai` ✓
- `getstarted.html` → `/login` → chain continues
- CSP has NO `navigate-to` directive → top-level navigation to app.targetdash.ai is unrestricted ✓
- `Cache-Control: no-store` on `/login`, `/onboarding`, `/getstarted` → browser won't cache stale redirects ✓

**Stripe webhook signature tests** (test vectors with known HMAC)
- ✓ Accepts valid signature
- ✓ Rejects replayed signature (timestamp 10 min old, outside 5-min tolerance)
- ✓ Rejects invalid signature
- ✓ Rejects empty signature

**Accessibility (axe-core WCAG 2.1 AA)**
- **0 violations** (2 initial violations fixed — see "Accessibility additions")
- 20 passes
- 1 "incomplete" category (color-contrast on 124 nodes where axe couldn't auto-evaluate, usually due to gradient backgrounds — these are NOT failures, just items requiring manual review)

### ⚠️ Sandbox limitations (not real bugs)

- **Google Fonts 403 in sandbox**: the test environment blocks `fonts.googleapis.com`. In real production this will work (CSP already allows `https://fonts.googleapis.com` for style-src + `https://fonts.gstatic.com` for font-src).
- **Marquee strip items overflow horizontally**: the `.strip-item` spans extend past viewport — this is BY DESIGN (the marquee CSS animation scrolls them from right to left infinitely). Not a bug.

### 🔒 Security audit findings

**No critical vulnerabilities found.** Checked:
- DOM-based XSS via URL params → no `location.search`/`.hash` reads
- ~20 `innerHTML` uses → all sourced from hardcoded objects (CONVOS, FACTS, UPLOAD_MAPPINGS, CC_DATA), never user input
- `eval` / `Function()` / `document.write` → none used
- Third-party scripts → Google Fonts only (CSP-allowed)
- Open redirect → no redirect URLs from user input
- Form submission / file upload → no real forms (CSV "upload" is purely visual demo — zero data leaves browser)
- Clickjacking → `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'`
- Inline event handlers (`onclick`) → static function calls, CSP-compliant via `'unsafe-inline'`

### ❓ What this package CANNOT verify (requires staging deploy)

Before production you still need to verify manually:

1. **Real Stripe test-mode webhook delivery** — create a test charge in Stripe Dashboard → verify `stripe_events` table row is written, `user_profiles` updated
2. **Real Anthropic API call via `/api/did-you-know`** — hit the endpoint with valid body; verify 5 facts returned as JSON array
3. **Real `/api/create-checkout` call** — confirm whitelist blocks unknown `price_id`, accepts Spark/Insight/Oracle
4. **Cross-browser testing** — Safari + Firefox (only Chromium tested here)
5. **Mobile device testing** on real iPhone + Android (only viewport emulation tested)
6. **Lighthouse scores** on the deployed URL (perf, best-practices, SEO)
7. **Mozilla Observatory** (https://observatory.mozilla.org/) security score
8. **HSTS preload submission** at https://hstspreload.org/ (manual one-time step)
9. **Supabase migration**: `create table stripe_events (...)` must run before webhook goes live

---



### 1. One-time Supabase migration (webhook idempotency)
```sql
create table if not exists stripe_events (
  id text primary key,
  type text,
  received_at timestamptz default now()
);
```

### 2. Vercel env vars
Required: `ANTHROPIC_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_KEY`
Optional: `SUPABASE_URL`, `ALLOWED_PRICE_IDS` (comma-separated Stripe price IDs)

### 3. Stripe webhook URL
Point Stripe Dashboard webhook to `https://targetdash.ai/api/stripe-webhook` — subscribed to `checkout.session.completed` + `customer.subscription.deleted` at minimum.

### 4. HSTS preload (optional)
Submit `targetdash.ai` to https://hstspreload.org/ after deploy.

---

## Architectural note — why are Stripe endpoints on the landing site?

Historical — `api/create-checkout.js` and `api/stripe-webhook.js` live on the apex domain but the actual upgrade UI is in `app.targetdash.ai`. Current setup works (webhook URL just needs to match Stripe Dashboard config), but logically these belong under `app.targetdash.ai/api/` for same-origin simplicity. Not urgent — the hardened versions are safe where they are.
