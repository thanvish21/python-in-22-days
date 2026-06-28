/* api/grade.js — Vercel Node serverless function for server-side grading of Tier 4 problems.

   Same-origin endpoint POST /api/grade. The frontend (js/runner.js -> HFTRunner.grade)
   posts { language, code, runtimeFlags?, tests:[{name,stdin,expectStdout,matchMode,
   timeBudgetMs,memBudgetKb,hidden}] } and expects:
     { passed, total, allPassed, results:[{ name, ok, hidden, timeMs, memKb }] }

   IMPORTANT: hidden-test expected values are NEVER leaked. Each result object exposes
   only name/ok/hidden/timeMs/memKb — no expectStdout, no stdin, no actual stdout. */

"use strict";

const { runViaJudge0, isConfigured, Judge0Error, ConfigError } = require("./_judge0.js");

const MS_PER_SECOND = 1000;

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body.length) {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

// Compare produced stdout against the expected value per matchMode.
// matchMode in: exact | trim | includes | regex. Default trim.
function compareStdout(actual, expected, matchMode) {
  const out = actual == null ? "" : String(actual);
  const exp = expected == null ? "" : String(expected);
  switch (matchMode) {
    case "exact":
      return out === exp;
    case "includes":
      return out.includes(exp);
    case "regex":
      try {
        return new RegExp(exp).test(out);
      } catch {
        return false;
      }
    case "trim":
    default:
      return out.trim() === exp.trim();
  }
}

module.exports = async (req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed. Use POST." });
    return;
  }

  if (!isConfigured()) {
    sendJson(res, 503, {
      error:
        "Execution backend not configured. Set JUDGE0_URL (and JUDGE0_KEY/JUDGE0_HOST for RapidAPI) in the Vercel project environment. See README 'Execution backend (Vercel)'.",
    });
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body." });
    return;
  }

  const { language, code, runtimeFlags, tests } = body || {};

  if (!language || typeof language !== "string") {
    sendJson(res, 400, { error: "Missing 'language'." });
    return;
  }
  if (typeof code !== "string" || !code.length) {
    sendJson(res, 400, { error: "Missing 'code'." });
    return;
  }
  if (!Array.isArray(tests) || !tests.length) {
    sendJson(res, 400, { error: "Missing 'tests' array." });
    return;
  }

  const flags = Array.isArray(runtimeFlags) ? runtimeFlags : [];

  try {
    const results = [];
    // Run tests sequentially to stay within a single Judge0 instance's rate limits
    // and the serverless function's time budget.
    for (const t of tests) {
      const opts = { stdin: typeof t.stdin === "string" ? t.stdin : "", runtimeFlags: flags };
      if (typeof t.timeBudgetMs === "number" && t.timeBudgetMs > 0) {
        opts.cpuSeconds = Math.max(1, Math.ceil(t.timeBudgetMs / MS_PER_SECOND));
      }
      if (typeof t.memBudgetKb === "number" && t.memBudgetKb > 0) {
        opts.memoryKb = t.memBudgetKb;
      }

      let r;
      try {
        r = await runViaJudge0(language, code, opts);
      } catch (err) {
        // A transport/config failure on one test fails that test rather than the batch.
        results.push({
          name: t.name || "test",
          ok: false,
          hidden: !!t.hidden,
          timeMs: null,
          memKb: null,
        });
        continue;
      }

      // Pass requires: program ran (not errored / not timed out) AND stdout matches.
      const stdoutOk = compareStdout(r.stdout, t.expectStdout, t.matchMode || "trim");
      const withinTime =
        typeof t.timeBudgetMs !== "number" ||
        r.timeMs == null ||
        r.timeMs <= t.timeBudgetMs;
      const ok = !!r.ok && !r.timedOut && stdoutOk && withinTime;

      // Expose ONLY safe fields — never expectStdout/stdin/actual stdout (hidden-test safety).
      results.push({
        name: t.name || "test",
        ok,
        hidden: !!t.hidden,
        timeMs: r.timeMs ?? null,
        memKb: r.memKb ?? null,
      });
    }

    const passed = results.filter((x) => x.ok).length;
    const total = results.length;
    sendJson(res, 200, { passed, total, allPassed: passed === total, results });
  } catch (err) {
    const status = err instanceof ConfigError ? 503 : err instanceof Judge0Error ? err.status || 502 : 500;
    sendJson(res, status, { error: err && err.message ? err.message : String(err) });
  }
};
