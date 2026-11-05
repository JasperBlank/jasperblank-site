# Jasper Blank Site

Personal portfolio site for Jasper Blank, built with React and Vite. The repository also hosts small static projects under `public/`, including the Epistack claim-source-map prototype submitted for the LessWrong epistemic case-study challenge.

Challenge context: [Lab leaks, black holes, and eggs: epistemic case study](https://www.lesswrong.com/posts/frizRHnA6AZpJSDqw/lab-leaks-black-holes-and-eggs-epistemic-case-study)

## What Judges Should Look At

The main challenge-relevant project is:

- **Epistack / Claim Source Map**
  - Live route when the site is deployed from its root: `/epistack/`
  - Source map app shell and renderer: [`public/epistack/index.html`](public/epistack/index.html)
  - Claim data: [`public/epistack/claims.js`](public/epistack/claims.js)

The claim-source-map is a static, browser-only epistemic tool for contested claims. It is designed around three layers:

1. **Layer 1: Sources** - primary-source links, quote snippets, provenance tiers, and drift notes.
2. **Layer 2: Structure** - typed Update Nodes that show priors, prior strength, source shifts, source weights, admissibility multipliers, dependence adjustments, and child-claim projections.
3. **Layer 3: Reader Overlay / Conclusion** - the computed distribution after source admission and editable assumptions cascade through the tree.

The important point is that the percentages are not just labels. They are decomposed into editable priors plus source-grounded update terms, so a reviewer can inspect where a number came from and change the assumptions.

## Repository Structure

- [`src/App.jsx`](src/App.jsx) - React portfolio landing page and project cards.
- [`src/main.jsx`](src/main.jsx) - React/Vite entry point.
- [`public/epistack/`](public/epistack/) - Epistack claim-source-map prototype.
- `public/mind-chess/` - static Mind Chess game.
- `public/1d-chess/` - static 1D Chess project.
- `public/hex-tictactoe.html` - static Hex Tic Tac Toe project.
- `public/scorekeeper/` - static boardgame scorekeeper.
- `public/warming-control/` - write-up of the TSC Life Sciences internship (closed-loop control for the Mistral-Air MA1200).
- `public/vessel-targeting/` - write-up of the master's thesis (stereo-endoscopic vessel targeting).
- `public/writeup.css` - shared styles for the write-up pages.

## Running Locally

```bash
npm install
npm run dev
```

Then open the Vite local URL and navigate to `/epistack/` for the claim-source-map prototype.

## Build

```bash
npm run build
```

The Vite build copies the static projects in `public/` into the deployed output, so `public/epistack/index.html` becomes the deployed `/epistack/` route.
