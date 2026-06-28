/* api/_judge0.js — shared Judge0 submit + poll + normalize helper for the Vercel
   serverless functions (api/run.js, api/grade.js).

   DUPLICATED per repo on purpose: Vercel bundles each function independently and does
   not allow importing files from outside the project root, so python-in-22-days and
   java-in-22-days each carry their own copy. Keep them in sync.

   Reuses hft-runner's Judge0 normalization (engines/judge0.js) plus the GC-log peak-heap
   parse (engines/local.js parseGcPeakKb) so Java memKb is populated from -Xlog:gc.

   Env:
     JUDGE0_URL          e.g. https://judge0-ce.p.rapidapi.com  or  https://your-judge0.fly.dev
     JUDGE0_KEY          optional X-RapidAPI-Key  (RapidAPI only)
     JUDGE0_HOST         optional X-RapidAPI-Host (RapidAPI only; defaults to JUDGE0_URL host)
     JUDGE0_LANG_PYTHON  Judge0 language_id (default 71 = Python 3)
     JUDGE0_LANG_JAVA    Judge0 language_id (default 62 = OpenJDK 13 / Java)
*/

"use strict";

const LANG = {
  python: Number(process.env.JUDGE0_LANG_PYTHON || 71),
  java: Number(process.env.JUDGE0_LANG_JAVA || 62),
};

const DEFAULT_CPU_SECONDS = 15;
const DEFAULT_MEMORY_KB = 256000;
const MS_PER_SECOND = 1000;
const KB_PER_MB = 1024;
const POLL_INTERVAL_MS = 600;
const POLL_MAX_ATTEMPTS = 40; // ~24s ceiling on top of Judge0's own cpu/wall limits

// Judge0 status ids: 1 In Queue, 2 Processing, 3 Accepted, 5 Time Limit Exceeded,
// 6 Compilation Error, 7-12 runtime/internal errors.
const STATUS_ACCEPTED = 3;
const STATUS_TIME_LIMIT = 5;

class Judge0Error extends Error {
  constructor(message, status) {
    super(message);
    this.name = "Judge0Error";
    this.status = status || 502;
  }
}

class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
    this.status = 503;
  }
}

function isConfigured() {
  return !!process.env.JUDGE0_URL;
}

function baseUrl() {
  const url = process.env.JUDGE0_URL;
  if (!url) {
    throw new ConfigError(
      "Execution backend not configured. Set JUDGE0_URL (and JUDGE0_KEY/JUDGE0_HOST for RapidAPI) in the Vercel project environment. See BACKEND.md."
    );
  }
  return url.replace(/\/$/, "");
}

function headers() {
  const h = { "Content-Type": "application/json" };
  if (process.env.JUDGE0_KEY) {
    h["X-RapidAPI-Key"] = process.env.JUDGE0_KEY;
    let host = process.env.JUDGE0_HOST;
    if (!host) {
      try {
        host = new URL(process.env.JUDGE0_URL).host;
      } catch {
        host = undefined;
      }
    }
    if (host) h["X-RapidAPI-Host"] = host;
  }
  return h;
}

// Best-effort peak heap (KB) from -Xlog:gc output like "12M->3M(256M)".
// Reused verbatim from hft-runner/engines/local.js so Java memKb is populated
// when the problem passes -Xlog:gc in runtimeFlags.
function parseGcPeakKb(text) {
  if (!text) return null;
  let peakMb = 0;
  const re = /(\d+)M->(\d+)M\((\d+)M\)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    peakMb = Math.max(peakMb, Number(m[1]), Number(m[2]));
  }
  return peakMb > 0 ? peakMb * KB_PER_MB : null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Normalize a finished Judge0 submission object into the platform's result shape.
function normalize(language, j) {
  const timedOut = j.status?.id === STATUS_TIME_LIMIT;
  const ok = j.status?.id === STATUS_ACCEPTED;
  const exitCode = j.exit_code ?? (ok ? 0 : 1);

  const stderr = [j.stderr, j.compile_output].filter(Boolean).join("\n").trimEnd();

  const timeSeconds = j.time != null ? parseFloat(j.time) : null;
  const timeMs =
    timeSeconds != null && !Number.isNaN(timeSeconds)
      ? Math.round(timeSeconds * MS_PER_SECOND * 1000) / 1000
      : null;

  // Judge0 `memory` is peak RSS in KB (good for Python). For Java, prefer the peak heap
  // parsed from the -Xlog:gc output when present; fall back to Judge0's memory otherwise.
  let memKb = j.memory ?? null;
  if (language === "java") {
    const gcKb = parseGcPeakKb((j.stdout || "") + "\n" + (j.stderr || ""));
    if (gcKb != null) memKb = gcKb;
  }

  return {
    ok,
    language,
    stdout: j.stdout || "",
    stderr,
    exitCode,
    timeMs,
    totalMs: timeMs != null ? Math.round(timeMs) : null,
    memKb,
    timedOut,
    status: j.status?.description || null,
  };
}

// Submit source to Judge0, poll until done, return normalized result.
// opts: { stdin, runtimeFlags[], args[], cpuSeconds, memoryKb }
async function runViaJudge0(language, code, opts = {}) {
  const language_id = LANG[language];
  if (!language_id) {
    throw new Judge0Error("Unsupported language for Judge0: " + language, 400);
  }
  const base = baseUrl();

  const runtimeFlags = Array.isArray(opts.runtimeFlags) ? opts.runtimeFlags : [];
  const args = Array.isArray(opts.args) ? opts.args : [];

  const body = {
    source_code: code,
    language_id,
    stdin: opts.stdin || "",
    command_line_arguments: args.join(" ") || undefined,
    // Java: runtimeFlags (GC/JIT) ride along as compiler/launcher options where the
    // Judge0 build supports them; ignored for Python which has no compile step.
    compiler_options: runtimeFlags.join(" ") || undefined,
    cpu_time_limit: opts.cpuSeconds || DEFAULT_CPU_SECONDS,
    memory_limit: opts.memoryKb || DEFAULT_MEMORY_KB,
  };

  // Try the fast path first (wait=true blocks until the submission finishes). Some hosted
  // Judge0 instances disable wait=true, so fall back to create-then-poll on failure.
  const created = await submit(base, body);
  if (created.finished) return normalize(language, created.data);

  return pollUntilDone(base, created.token, language);
}

// POST a submission. Returns { finished:true, data } if wait=true gave us a final result,
// else { finished:false, token } to poll.
async function submit(base, body) {
  let res;
  try {
    res = await fetch(`${base}/submissions?base64_encoded=false&wait=true`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Judge0Error("Could not reach Judge0: " + (err?.message || String(err)), 502);
  }

  if (!res.ok) {
    const text = await safeText(res);
    throw new Judge0Error(`Judge0 submit failed (${res.status}): ${text}`, 502);
  }

  const data = await res.json();
  if (data && data.status && data.status.id > 2) {
    // wait=true honored — already finished.
    return { finished: true, data };
  }
  if (data && data.token) {
    // wait=true not honored; we only got a token.
    return { finished: false, token: data.token };
  }
  // Some builds return the full object even when queued; treat presence of status as final.
  if (data && data.status) return { finished: true, data };
  throw new Judge0Error("Unexpected Judge0 response (no status or token).", 502);
}

async function pollUntilDone(base, token, language) {
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    await delay(POLL_INTERVAL_MS);
    let res;
    try {
      res = await fetch(`${base}/submissions/${encodeURIComponent(token)}?base64_encoded=false`, {
        headers: headers(),
      });
    } catch (err) {
      throw new Judge0Error("Could not reach Judge0 while polling: " + (err?.message || String(err)), 502);
    }
    if (!res.ok) {
      const text = await safeText(res);
      throw new Judge0Error(`Judge0 poll failed (${res.status}): ${text}`, 502);
    }
    const data = await res.json();
    if (data && data.status && data.status.id > 2) {
      return normalize(language, data);
    }
  }
  throw new Judge0Error("Judge0 timed out waiting for a result.", 504);
}

async function safeText(res) {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "(no body)";
  }
}

module.exports = {
  runViaJudge0,
  normalize,
  parseGcPeakKb,
  isConfigured,
  Judge0Error,
  ConfigError,
  LANG,
};
