/* ===== pyrunner.js — loads Pyodide once, runs user Python, captures output ===== */
(function () {
  "use strict";

  let pyodidePromise = null;
  let ready = false;

  // Lazily start loading Pyodide. Returns a promise resolving to the instance.
  function getPyodide(onStatus) {
    if (pyodidePromise) return pyodidePromise;
    if (typeof loadPyodide !== "function") {
      return Promise.reject(new Error("Pyodide script not loaded yet. Check your connection."));
    }
    if (onStatus) onStatus("Waking up the Python snake… (first time can take 10-20s)");
    pyodidePromise = loadPyodide({
      indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.2/full/",
    }).then((py) => {
      ready = true;
      return py;
    });
    return pyodidePromise;
  }

  // Run Python source, return { ok, stdout, error }. Captures stdout + stderr.
  async function run(code, onStatus) {
    let py;
    try {
      py = await getPyodide(onStatus);
    } catch (e) {
      return { ok: false, stdout: "", error: String(e.message || e) };
    }

    // Reset stdout/stderr capture buffers for each run.
    const captured = { out: "" };
    py.setStdout({ batched: (s) => { captured.out += s + "\n"; } });
    py.setStderr({ batched: (s) => { captured.out += s + "\n"; } });
    // Wire input() to a browser popup so input lessons work live.
    py.setStdin({
      stdin: () => {
        const v = window.prompt("🐍 Your program is asking for input:");
        if (v === null) return "";        // user cancelled -> EOF
        captured.out += v + "\n";          // echo what they typed, like a real terminal
        return v + "\n";
      },
    });

    try {
      // Run the user's code through a wall-clock watchdog so a runaway loop
      // self-terminates (~12s) instead of freezing the page forever.
      py.globals.set("__USER_SRC__", code);
      await py.runPythonAsync(WATCHDOG);
      return { ok: true, stdout: captured.out, error: "" };
    } catch (err) {
      // Pyodide surfaces Python tracebacks as the error message.
      return { ok: false, stdout: captured.out, error: cleanTraceback(String(err.message || err)) };
    } finally {
      try { py.globals.delete("__USER_SRC__"); } catch (e) { /* noop */ }
    }
  }

  // Python wrapper: compiles the user source, runs it under a line tracer that
  // raises after a time budget. User code keeps its own line numbers ("<lesson>").
  const WATCHDOG = [
    "import sys as _sys, time as _time",
    "_src = __USER_SRC__",
    "_code = compile(_src, '<lesson>', 'exec')",
    "_deadline = _time.time() + 12",
    "def _guard(_f, _e, _a):",
    "    if _time.time() > _deadline:",
    "        raise TimeoutError('Stopped: your code ran for over 12 seconds. Did a loop forget to stop? (infinite loop)')",
    "    return _guard",
    "_ns = {'__name__': '__main__'}",
    "_sys.settrace(_guard)",
    "try:",
    "    exec(_code, _ns)",
    "finally:",
    "    _sys.settrace(None)",
  ].join("\n");

  // Show only the learner's own frames. Pyodide + our watchdog add wrapper frames
  // (_base.py, "<exec>", settrace) above the real error — strip them out.
  function cleanTraceback(msg) {
    const lines = msg.split("\n");
    const hasTb = lines.some((l) => l.includes("Traceback"));
    // The first frame that belongs to the learner's code is labeled "<lesson>".
    const firstUser = lines.findIndex((l) => l.includes('File "<lesson>"'));
    let body = firstUser >= 0
      ? lines.slice(firstUser)
      : lines.slice(lines.findIndex((l) => l.includes("Traceback")) + 1);
    body = body.filter((l) => {
      const internal = [
        "_pyodide/_base.py", 'File "<exec>"', "eval_code_async", "run_async",
        "coroutine = eval", "CodeRunner(", "_sys.settrace", "exec(_code", "in _guard",
      ];
      return !internal.some((s) => l.includes(s));
    });
    const out = (hasTb ? "Traceback (most recent call last):\n" : "") + body.join("\n");
    return out.replace(/<lesson>/g, "your code").trim();
  }

  // Perf run: execute user code WITHOUT the line tracer (tracing distorts timing) and
  // report honest in-browser numbers — wall time via perf_counter, peak Python-object
  // memory via tracemalloc. Numbers are Pyodide/WASM (single-threaded, slower than native);
  // for real native timing / multiprocessing use the hft-runner backend. No watchdog here,
  // so this is for well-formed benchmark snippets, not arbitrary student loops.
  async function runPerf(code, onStatus) {
    let py;
    try { py = await getPyodide(onStatus); }
    catch (e) { return { ok: false, stdout: "", error: String(e.message || e), timeMs: null, memKb: null }; }

    const captured = { out: "" };
    py.setStdout({ batched: (s) => { captured.out += s + "\n"; } });
    py.setStderr({ batched: (s) => { captured.out += s + "\n"; } });
    try {
      py.globals.set("__USER_SRC__", code);
      await py.runPythonAsync(PERF_HARNESS);
      const timeMs = py.globals.get("__HFT_TIME_MS__");
      const memKb = py.globals.get("__HFT_PEAK_KB__");
      return { ok: true, stdout: captured.out, error: "", timeMs, memKb };
    } catch (err) {
      return { ok: false, stdout: captured.out, error: cleanTraceback(String(err.message || err)), timeMs: null, memKb: null };
    } finally {
      try { py.globals.delete("__USER_SRC__"); } catch (e) { /* noop */ }
    }
  }

  // Grading run: execute `code` with a fixed `stdin` string (no popups). Lines are
  // fed to input()/sys.stdin in order; reading past the end yields EOF. Returns
  // { ok, stdout, error } so the grader can compare stdout per matchMode. Watchdog
  // still guards against runaway loops.
  async function runWithInput(code, stdin) {
    let py;
    try { py = await getPyodide(); }
    catch (e) { return { ok: false, stdout: "", error: String(e.message || e) }; }

    const captured = { out: "" };
    py.setStdout({ batched: (s) => { captured.out += s + "\n"; } });
    py.setStderr({ batched: (s) => { captured.out += s + "\n"; } });

    // Split the provided stdin into lines; each input()/readline call consumes one.
    const text = stdin == null ? "" : String(stdin);
    const lines = text.length ? text.split("\n") : [];
    // A trailing "\n" produces an empty final element — drop it so we don't hand back
    // a phantom blank line after the real input.
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    let idx = 0;
    py.setStdin({
      stdin: () => {
        if (idx >= lines.length) return null;   // EOF
        return lines[idx++] + "\n";
      },
    });

    try {
      py.globals.set("__USER_SRC__", code);
      await py.runPythonAsync(WATCHDOG);
      return { ok: true, stdout: captured.out, error: "" };
    } catch (err) {
      return { ok: false, stdout: captured.out, error: cleanTraceback(String(err.message || err)) };
    } finally {
      try { py.globals.delete("__USER_SRC__"); } catch (e) { /* noop */ }
    }
  }

  const PERF_HARNESS = [
    "import time as _t, tracemalloc as _tm",
    "_code = compile(__USER_SRC__, '<lesson>', 'exec')",
    "_ns = {'__name__': '__main__'}",
    "_tm.start()",
    "_t0 = _t.perf_counter()",
    "try:",
    "    exec(_code, _ns)",
    "finally:",
    "    _t1 = _t.perf_counter()",
    "    _cur, _peak = _tm.get_traced_memory()",
    "    _tm.stop()",
    "    __HFT_TIME_MS__ = (_t1 - _t0) * 1000.0",
    "    __HFT_PEAK_KB__ = _peak / 1024.0",
  ].join("\n");

  window.PyRunner = { run, runWithInput, runPerf, getPyodide, isReady: () => ready };
})();
