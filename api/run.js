/* api/run.js — Vercel Node serverless function for native Python (Tier 4) execution.

   Same-origin endpoint POST /api/run. The frontend (js/runner.js -> HFTRunner.run)
   posts { language, code, stdin?, runtimeFlags?, args?, timeoutMs? } and expects the
   normalized result shape produced by api/_judge0.js normalize():
   { ok, stdout, stderr, exitCode, timeMs, totalMs, memKb, timedOut, ... }.

   Execution proxies to Judge0 with the key kept server-side in Vercel env vars
   (JUDGE0_URL etc — see api/_judge0.js and README "Execution backend (Vercel)"). */

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

// Vercel parses JSON bodies into req.body, but fall back to reading the stream
// if it arrives raw (e.g. unusual content-type or local invocation).
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

module.exports = async (req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method not allowed. Use POST." });
    return;
  }

  if (!isConfigured()) {
    // 503 so the client can distinguish "not configured" from a transient failure;
    // js/runner.js surfaces the error string. Pyodide Tier 1-3 keeps working regardless.
    sendJson(res, 503, {
      ok: false,
      error:
        "Execution backend not configured. Set JUDGE0_URL (and JUDGE0_KEY/JUDGE0_HOST for RapidAPI) in the Vercel project environment. See README 'Execution backend (Vercel)'.",
    });
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    sendJson(res, 400, { ok: false, error: "Invalid JSON body." });
    return;
  }

  const { language, code, stdin, runtimeFlags, args, timeoutMs } = body || {};

  if (!language || typeof language !== "string") {
    sendJson(res, 400, { ok: false, error: "Missing 'language'." });
    return;
  }
  if (typeof code !== "string" || !code.length) {
    sendJson(res, 400, { ok: false, error: "Missing 'code'." });
    return;
  }

  const opts = {
    stdin: typeof stdin === "string" ? stdin : "",
    runtimeFlags: Array.isArray(runtimeFlags) ? runtimeFlags : [],
    args: Array.isArray(args) ? args : [],
  };
  // timeoutMs (client wall budget) maps to Judge0's cpu_time_limit in seconds.
  if (typeof timeoutMs === "number" && timeoutMs > 0) {
    opts.cpuSeconds = Math.max(1, Math.ceil(timeoutMs / MS_PER_SECOND));
  }

  try {
    const result = await runViaJudge0(language, code, opts);
    sendJson(res, 200, result);
  } catch (err) {
    const status = err instanceof ConfigError ? 503 : err instanceof Judge0Error ? err.status || 502 : 500;
    sendJson(res, status, { ok: false, error: err && err.message ? err.message : String(err) });
  }
};
