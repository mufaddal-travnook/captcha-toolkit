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

### Method A — OCR (native, `tesseract.js`)
1. Read image size → split into cell boxes ([`grid.ts`](src/core/grid.ts)).
2. Crop each cell (`sharp`).
3. OCR each cell, digits-only whitelist.
4. Compare to target → mark matches.

No external API, runs fully offline. Requires a known `targetNumber`.

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
    types.ts                # CaptchaSolution, Cell, Grid, Solver interface
    grid.ts                 # geometry: split grid, index<->pixel center
    text.ts                 # digit normalization & matching
  features/
    captcha-solver/         # FEATURE 1 (Solver contract lives in core/types.ts)
      OcrSolver.ts          # method A
      OpenAiSolver.ts       # method B
      index.ts              # createSolver() factory — pick by name
  cli.ts                    # run a solver against an image file
  index.ts                  # public package surface
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

```bash
# Method A — OCR
npm run solve -- --image ./samples/captcha.png --target 447 --solver ocr

# Method B — OpenAI (requires OPENAI_API_KEY)
npm run solve -- --image ./samples/captcha.png --target 447 --solver openai

# Custom grid
npm run solve -- --image ./grid.png --target 447 --rows 3 --cols 3 --solver ocr
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
