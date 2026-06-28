# 1% HFT Matrix — Python Platform Contract (authoritative)

This file is the single source of truth. Frontend plumbing and content agents both
conform to it exactly. Field names are normative — do not rename.

## Architecture
- Static site on Vercel (no framework). `index.html` + `js/*` + `data/*.json`.
- Python Tier 1–3 execute **in-browser via Pyodide** (`js/pyrunner.js`), free + offline.
- Python Tier 4 (multiprocessing / native / GIL escape) executes on the **backend**:
  Vercel serverless functions `api/run.js` + `api/grade.js` that proxy to Judge0
  (key stays server-side in Vercel env). Browsers cannot fork processes or load C-ext.
- `js/runner.js` posts to `window.HFT_RUNNER_URL` (default `"/api"`) at `/run` and `/grade`.
- `js/onepct.js` provides the 1% dark-terminal toggle, `profile()` (time+mem), and
  `estimateComplexity()` (empirical Big-O). Already built — reuse, don't reinvent.

## Curriculum (replaces the old 22-day PCEP content entirely)
Four tiers. Each is one file `data/tier1.json` … `data/tier4.json`.
1. Asynchronous Network Foundations — asyncio, coroutine pipelines, bounded concurrency,
   throughput under backpressure / rate-limit-respecting schedulers.
2. High-Performance Memory Management — generators, iterators, `__slots__`, streaming
   parsers that process huge inputs without OOM.
3. Advanced Metaprogramming & Hooks — descriptors, class decorators, metaclasses,
   context managers (`__enter__`/`__exit__`), runtime hooks.
4. GIL Escape & Native Extensions — `multiprocessing` to escape the GIL on CPU-bound work,
   `ctypes`/native extension mounting, parallel speedup measurement. **engine = backend.**

## Framing rule
Reframe any "bypass" language as legitimate engineering: "throughput under backpressure"
(not bypassing rate limits), "escape the GIL with multiprocessing/native code" (not
hacking the interpreter). Problems train real HFT/elite-interview skills.

## `data/tiers.json` (tier manifest — replaces manifest.json's role)
```json
{
  "track": "Python Systems Engineering — 1% HFT Matrix",
  "tiers": [
    { "tier": 1, "emoji": "⚡", "title": "Asynchronous Network Foundations",
      "tag": "asyncio", "summary": "one-line summary" }
  ]
}
```

## `data/tierN.json` (one tier)
```json
{
  "tier": 1,
  "language": "python",
  "emoji": "⚡",
  "title": "Asynchronous Network Foundations",
  "subtitle": "short tagline",
  "goal": "what the engineer can do after this tier",
  "estMinutes": 240,
  "tags": ["asyncio", "coroutines", "throughput"],
  "blocks": [ /* teaching blocks, see below */ ],
  "problems": [ /* graded challenges, see below */ ]
}
```

### `blocks[]` — teaching content (reuse existing renderer block types)
Allowed `type`: `text`, `code`, `tip`, `quiz`, `tryit`.
- `text`: `{ "type":"text", "heading":"…", "html":"<p>…</p>" }`
- `code`: `{ "type":"code", "caption":"…", "code":"…", "explain":"…", "editable":true }`
- `tip`: `{ "type":"tip", "variant":"warn"?, "html":"…" }`
- `quiz`: `{ "type":"quiz", "question":"…", "options":[…], "answerIndex":0, "explain":"…" }`
- `tryit`: `{ "type":"tryit", "title":"…", "instructions":"…", "starter":"…",
    "check": { "stdout_includes"|"stdout_equals"|"code_includes"|"regex": … },
    "solution":"…", "passMsg":"…", "failMsg":"…" }`
Content must be HFT/senior level — no "hello world". Density over fluff.

### `problems[]` — graded challenges (the core of each tier)
```json
{
  "id": "py-t1-p1",
  "title": "Bounded-concurrency async fetcher",
  "difficulty": "hard",
  "instructions": "<p>HTML. State the exact constraints: latency budget, max in-flight, ordering.</p>",
  "language": "python",
  "engine": "pyodide",
  "starter": "full runnable skeleton with TODOs; reads stdin, prints to stdout",
  "solution": "complete correct reference solution",
  "runtimeFlags": [],
  "stdin": "default stdin for the Run button (optional)",
  "tests": [
    { "name": "basic", "stdin": "…", "expectStdout": "…",
      "matchMode": "trim", "timeBudgetMs": 2000, "memBudgetKb": 65536, "hidden": false },
    { "name": "stress 1e6", "stdin": "…", "expectStdout": "…",
      "matchMode": "trim", "timeBudgetMs": 1500, "memBudgetKb": 131072, "hidden": true }
  ],
  "complexity": {
    "codeTemplate": "code with {N} substituted to scale input size",
    "sizes": [1000, 2000, 4000, 8000, 16000],
    "expected": "O(n log n)"
  },
  "hint": "one nudge, not the answer"
}
```
Rules:
- `engine`: `"pyodide"` for Tier 1–3, `"backend"` for Tier 4. Backend problems still ship
  `starter`/`solution`/`tests`; they just grade server-side.
- `matchMode` ∈ `exact` | `trim` | `includes` | `regex`. Default `trim`.
- Every problem MUST have ≥1 visible test and ≥1 hidden test. Hidden tests gate "mastery".
- I/O contract: problems read from **stdin**, write to **stdout** (so the same code grades
  in Pyodide and on the backend). State the format precisely in `instructions`.
- `complexity` is optional but expected on ≥1 problem per tier; `codeTemplate` must be a
  self-contained benchmark that grows with `{N}`.
- Provide 3–5 problems per tier. Real, hard, interview-grade. No placeholder strings.

## Grading contract
- Pyodide problems: frontend runs `starter`/user code per test with that test's `stdin`,
  compares stdout per `matchMode`. (`js/pyrunner.js` exposes `runWithInput(code, stdin)`.)
- Backend problems: frontend calls `window.HFTRunner.grade({language, code, runtimeFlags,
  tests})` → `{ passed, total, allPassed, results:[{name, ok, hidden, timeMs, memKb}] }`.
  Hidden test details are not revealed beyond pass/fail count.

## Profile + complexity UI
Each graded problem card shows buttons: ▶ Run · ⏱ Profile · ✓ Grade · 💡 Solution, plus
📈 Complexity when `problem.complexity` exists. Profile uses `window.OnePct.profile`;
complexity uses `window.OnePct.estimateComplexity`. Show time (µs/ms) + peak memory.

## File ownership (no two agents touch the same file)
- Frontend agent: `index.html`, `js/render.js`, `js/app.js`, `js/pyrunner.js`,
  `css/onepct.css`, `data/tiers.json`. Removes day/module/exam wiring (course.js include,
  PCEP nav). Do NOT touch `js/runner-config.js`, `vercel.json`, `api/*`.
- Backend agent: `api/run.js`, `api/grade.js`, `js/runner-config.js`, `vercel.json`, docs.
- Content agents: exactly one `data/tierN.json` each. Nothing else.
