/* ===== runner.js — unified execution client for the 1% mastery platform =====
   Talks to the hft-runner backend (POST /run, /grade) when window.HFT_RUNNER_URL is set.
   Used for: real Java execution, Python multiprocessing/native (Tier 4), and honest
   wall-time + peak-memory numbers. Pure-Python quick runs still go through Pyodide
   (js/pyrunner.js) so the site keeps working offline and for free. */
(function () {
  "use strict";

  function base() {
    return (window.HFT_RUNNER_URL || "").replace(/\/$/, "");
  }
  function configured() {
    return !!base();
  }

  async function post(path, body) {
    const url = base() + path;
    if (!base()) throw new Error("Backend not configured (window.HFT_RUNNER_URL is empty).");
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.json()).error || ""; } catch { /* ignore */ }
      throw new Error("Runner " + res.status + (detail ? ": " + detail : ""));
    }
    return res.json();
  }

  // { language, code, stdin?, runtimeFlags?, args?, timeoutMs? } -> normalized result
  function run(opts) { return post("/run", opts); }

  // { language, code, runtimeFlags?, tests:[...] } -> { passed, total, allPassed, results }
  function grade(opts) { return post("/grade", opts); }

  // Empirical complexity: run `codeTemplate` (with {N} substituted) across `sizes`,
  // collect wall time, and classify growth. runner is an async (code)->{timeMs,memKb}.
  async function complexity(opts) {
    const sizes = opts.sizes || [1000, 2000, 4000, 8000, 16000];
    const runner = opts.runner || (async (code) => {
      const r = await run({ language: opts.language, code, runtimeFlags: opts.runtimeFlags });
      return { timeMs: r.timeMs ?? r.totalMs, memKb: r.memKb };
    });
    const points = [];
    for (const n of sizes) {
      const code = opts.codeTemplate.replace(/\{N\}/g, String(n));
      const { timeMs, memKb } = await runner(code);
      points.push({ n, timeMs, memKb });
    }
    return { points, fit: classify(points), bigO: classify(points).label };
  }

  // Estimate the exponent k in time ~ n^k via a log-log least-squares slope, then snap
  // to the nearest familiar class. n*log n shows up as a slope just above 1.
  function classify(points) {
    const usable = points.filter((p) => p.timeMs > 0 && p.n > 0);
    if (usable.length < 2) return { label: "indeterminate", slope: null };
    const xs = usable.map((p) => Math.log(p.n));
    const ys = usable.map((p) => Math.log(p.timeMs));
    const mx = avg(xs), my = avg(ys);
    let num = 0, den = 0;
    for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
    const slope = den === 0 ? 0 : num / den;
    let label;
    if (slope < 0.3) label = "O(1) constant";
    else if (slope < 0.85) label = "O(log n) / sublinear";
    else if (slope < 1.25) label = "O(n) linear";
    else if (slope < 1.6) label = "O(n log n)";
    else if (slope < 2.4) label = "O(n²) quadratic";
    else label = "O(n³+) — superquadratic";
    return { label, slope: Math.round(slope * 100) / 100 };
  }
  function avg(a) { return a.reduce((s, x) => s + x, 0) / a.length; }

  window.HFTRunner = { run, grade, complexity, classify, configured };
})();
