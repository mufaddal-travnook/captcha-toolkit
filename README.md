# captcha-toolkit

A future-proof, **feature-modular** Node.js + TypeScript toolkit. Each feature lives in its own folder, depends only on shared **core contracts** (not on other features), and is independently testable.

> **First feature:** solve a grid captcha and output the target number and the matching boxes — via **OCR (native)** or the **OpenAI Vision API**.

---

## How it solves the captcha (and how it helps you click)

The captcha is a grid (e.g. 3×3) with a prompt like _"select all boxes with number 447"_. The solver's job is **not** to click — it's to tell a future clicker **where** to click.

```
┌────────────┐    ┌───────────────┐    ┌──────────────────┐    ┌─────────────┐
│ captcha png │ -> │    SOLVER     │ -> │  matches + pixel │ -> │   CLICKER   │
│             │    │ (OCR / OpenAI)│    │  centers (x,y)   │    │ (future)    │
└────────────┘    └───────────────┘    └──────────────────┘    └─────────────┘
```

Both solvers return the **same JSON contract** ([`CaptchaSolution`](src/core/types.ts)):

```jsonc
{
  "targetNumber": "447",
  "grid": { "rows": 3, "cols": 3 },
  "cells": [
    { "index": 0, "row": 0, "col": 0, "value": "447", "match": true,
      "box": { "x": 0, "y": 0, "width": 100, "height": 100 },
      "center": { "x": 50, "y": 50 } }
    // ... 8 more
  ],
  "matches": [0, 5, 8]   // <- the boxes to click
}
```

**Key design point:** OCR / OpenAI only **read numbers**. The pixel geometry — splitting the grid, computing each cell's center — is done **locally** in [`src/core/grid.ts`](src/core/grid.ts). So the AI never "clicks", and the clicker just consumes `matches` + `center`.

### Method A — OCR (native, `tesseract.js`), two-stage

**Stage 1 — read the target number** ([`targetReader.ts`](src/features/captcha-solver/targetReader.ts)):
1. Crop the top instruction band ("Please select all boxes with number 343").
2. OCR it (the prompt text is dark/clean, so OCR reads it well).
3. Regex the first 3-digit number → the target. *(No `--target` needed.)*

**Stage 2 — read the grid cells** ([`OcrSolver.ts`](src/features/captcha-solver/OcrSolver.ts)):
1. Crop the grid region and split into 9 cells with **absolute** coordinates
   (so `center` lands on the real tiles — accurate click points).
2. Preprocess each cell: inset (skip tile border) → denoise → **per-cell Otsu
   binarization** ([`otsu.ts`](src/core/otsu.ts), adapts to each digit's color) →
   trim + pad.
3. OCR each cell under multiple page-seg modes and **vote** for the best read.
4. Compare to target → mark matches.

Runs fully offline. Region fractions are configurable via `OcrSolverOptions`.

> **Honest limitation:** these captchas are *designed* to defeat OCR (stylized,
> pastel, textured). Tesseract reliably reads the target and most tiles, but the
> lowest-contrast pastel cells are hit-or-miss. For full accuracy, use method B.
> Inspect what OCR sees with `npm run dump` (writes cell crops to `samples/cells/`).

### Method B — OpenAI Vision (`gpt-4o`)
1. Send the whole image + a structured JSON prompt.
2. Model returns each cell's number (and can read the target from the prompt text).
3. Geometry/centers still computed locally → same contract.

More robust on noisy/stylized digits; needs `OPENAI_API_KEY` and is billed per call.

---

## Project structure

```
src/
  core/                     # shared contracts & pure helpers (used by ALL features)
    types.ts                # CaptchaSolution, Cell, Grid, FractionalRegion, Solver
    grid.ts                 # geometry: split grid/region, region<->pixel, center
    text.ts                 # digit normalization & matching
    otsu.ts                 # per-cell adaptive binarization threshold (pure)
  features/
    captcha-solver/         # FEATURE 1 (Solver contract lives in core/types.ts)
      OcrSolver.ts          # method A, stage 2 (grid cells) + multi-PSM voting
      targetReader.ts       # method A, stage 1 (read target from instruction band)
      OpenAiSolver.ts       # method B
      prompt.ts             # dedicated OpenAI prompt (tune without touching solver)
      debug.ts              # dump cell crops for inspection (npm run dump)
      index.ts              # createSolver() factory — pick by name
  cli.ts                    # run a solver against an image file
  index.ts                  # public package surface
samples/                    # << put your captcha.png input images here
tests/                      # independent unit tests per piece
```

**Adding a feature later** (e.g. a `clicker`): create `src/features/clicker/`, depend on `core/types`, expose its own `index.ts`. It consumes `CaptchaSolution` — no change to the solver.

**Adding a 3rd solver** (e.g. another vision model): one new file implementing `Solver` + one `case` in [`createSolver`](src/features/captcha-solver/index.ts).

---

## Setup

```bash
npm install
cp .env.example .env   # only needed for the OpenAI solver
```

## Usage (CLI)

Put your captcha image in [`samples/`](samples/) as `captcha.png` (the default the CLI reads), or pass any path with `--image`.

```bash
# Method A — OCR (reads samples/captcha.png; auto-reads the target from the prompt)
npm run solve -- --solver ocr

# Method B — OpenAI (requires OPENAI_API_KEY)
npm run solve -- --solver openai

# Override the target instead of auto-reading it
npm run solve -- --target 343 --solver ocr

# Explicit path / custom grid
npm run solve -- --image ./samples/other.png --target 447 --rows 3 --cols 3 --solver ocr
```

## Usage (programmatic)

```ts
import { readFile } from 'node:fs/promises';
import { createSolver } from 'captcha-toolkit';

const image = await readFile('captcha.png');
const solver = createSolver('ocr'); // or 'openai'
const solution = await solver.solve({ image, targetNumber: '447' });

console.log(solution.matches);                 // [0, 5, 8]
console.log(solution.cells[0].center);         // { x: 50, y: 50 } -> clicker target
```

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run dev` | Run `src/index.ts` with `tsx` |
| `npm run solve` | Run the CLI solver |
| `npm run dump` | Dump grid cell crops to `samples/cells/` for inspection |
| `npm test` | Run unit tests (`vitest`) |
| `npm run typecheck` | Type-check without emitting |

## Testing

Every piece is independently testable:
- `tests/grid.test.ts` — pure geometry.
- `tests/text.test.ts` — digit normalization.
- `tests/openai-solver.test.ts` — solver logic with a **mocked** OpenAI client (no network, no API key).

```bash
npm test
```

## License

MIT
