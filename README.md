# python-in-22-days

**A zero-install Python course that runs real CPython in the browser via Pyodide — 25 daily lessons, every snippet verified against a local interpreter before it ships.**

![JavaScript](https://img.shields.io/badge/frontend-vanilla%20JS-f7df1e)
![Pyodide](https://img.shields.io/badge/runtime-Pyodide%200.26-3776ab)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)
[![Repository Baseline](https://github.com/thanvish21/python-in-22-days/actions/workflows/repository-baseline.yml/badge.svg)](https://github.com/thanvish21/python-in-22-days/actions/workflows/repository-baseline.yml)

## The problem

Learning Python usually stalls before line one: install an interpreter, pick an editor,
fight `PATH`. Meanwhile the tutorials themselves are unverified — snippets rot and the
learner ends up debugging the lesson.

This project removes both obstacles. Lessons run **actual Python in the browser** through
Pyodide (CPython compiled to WebAssembly), and `verify.py` compiles and executes every
snippet in the repository so a broken example never reaches a learner.

## Quickstart

Static site, no build step. Lessons load with `fetch`, so serve over HTTP — `file://`
will not work.

```bash
git clone https://github.com/thanvish21/python-in-22-days.git
cd python-in-22-days
python3 -m http.server 8000
# open http://localhost:8000
```

Verify every lesson before publishing content:

```bash
python3 verify.py    # schema check + compile/run every snippet; exits non-zero on failure
```

Deploy to Vercel (`vercel.json` is committed: clean URLs, `X-Content-Type-Options:
nosniff`, always-revalidate on `/data/*`), or serve the folder from GitHub Pages — the
core course needs no server-side code at all.

## How it works

- **Real execution, client-side.** `js/pyrunner.js` lazily loads Pyodide 0.26.2 from the
  jsDelivr CDN on first Run (10-20s cold start), then reuses the instance. stdout and
  stderr are captured per run and `input()` is wired to a browser prompt so input lessons
  work live.
- **Runaway-loop watchdog.** User code is executed under a `sys.settrace` guard with a
  12-second wall-clock deadline, so an infinite loop raises a readable `TimeoutError`
  instead of freezing the tab. Tracebacks are filtered down to the learner's own frames.
- **Progress and gating.** State lives in `localStorage` (`py25_progress_v1`). Day 1 is
  always open; day *N* unlocks when day *N-1* is done. Days 6, 11, 16 and 22 are gated
  behind a timed module test that must be passed at 70% or better (`py25_tests_v1`).
  Finishing a day fires a badge toast and increments the streak counter.
- **Content pipeline.** One JSON file per lesson (`data/dayNN.json`) with typed `blocks`
  (`text`, `code`, `tip`, `quiz`, `tryit`, `example`, …) and a closing `challenge`.
  `verify.py` walks every file, schema-checks it, and runs each snippet — including
  `tryit` starters and solutions — reporting input-driven snippets as warnings.

```
index.html          app shell
js/pyrunner.js      Pyodide loader, stdout capture, 12s watchdog, traceback cleanup
js/render.js        lesson JSON -> interactive DOM
js/app.js           hash router, progress, day unlock, badges
js/course.js        module outline, timed module tests, PCEP exam-map page
js/ai-tutor.js      "PyBuddy" chat panel (see Status below)
api/run.js          Vercel function: run code via Judge0 (used by the advanced track)
api/grade.js        Vercel function: hidden-test grading, never leaks expectations
api/_judge0.js      shared Judge0 submit/poll/normalize helper
data/manifest.json  the day list
data/dayNN.json     one lesson per file, 25 files
data/modules.json   PCEP module grouping + module-test question banks
matrix/             advanced "1% HFT Matrix" track (own README + data/SCHEMA.md)
test/headless.html  manual smoke page for the Pyodide runner
verify.py           schema + compile/run check for every lesson
```

**Course shape.** 25 lessons from `print()` and variables through loops, collections,
functions, error handling, files, modules, classes, comprehensions, `pip`, and a capstone.
`data/modules.json` groups them into the module layout used by the PCEP-30-02 exam map,
and the module tests use its question banks.

**Advanced track.** `matrix/` is a separate four-tier systems-Python curriculum — async
network foundations, memory management, metaprogramming and hooks, and GIL escape /
native extensions — with 18 graded problems. Tiers 1-3 quick-runs work in Pyodide; tier-4
native work and the profiling harness need the Judge0-backed serverless functions
(`window.HFT_RUNNER_URL`, default `/api`).

## Configuration

| Variable | Used by | Notes |
|---|---|---|
| `JUDGE0_URL` | `api/run.js`, `api/grade.js` | Judge0 instance for the advanced track |
| `JUDGE0_KEY`, `JUDGE0_HOST` | same | RapidAPI only |
| `JUDGE0_LANG_PYTHON` | same | Judge0 language id, default `71` |

## Tech stack

Vanilla HTML/CSS/JavaScript with no framework, bundler or npm dependencies · Pyodide
0.26.2 (CPython on WebAssembly) · Vercel Node serverless functions
(`@vercel/node@3.2.0`) · Judge0 for the advanced track · Python 3 for the offline verifier.

## Status and known gaps

- The curriculum is **25 days**, not 22 — the repository name predates the expansion.
- **The AI tutor panel is not functional as shipped.** `js/ai-tutor.js` posts a
  proxy-shaped body straight to `https://openrouter.ai/api/v1/chat/completions` with no
  credentials, and this repo contains no `api/tutor.js` to receive it. Wiring it up means
  adding that serverless proxy (as done in the sibling Java repo) and pointing the client
  at it.
- Pyodide is fetched from a CDN, so the first Run needs a network connection and takes
  10-20 seconds; only pure-Python standard-library code is guaranteed to work.
- Progress is per-browser `localStorage` — no accounts or sync.
- `test/headless.html` is a manual smoke page, not an automated test suite.

## License

MIT — see [LICENSE](LICENSE).
