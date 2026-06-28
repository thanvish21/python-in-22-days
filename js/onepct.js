/* ===== onepct.js — "1% Assessment Mode" toggle + perf/complexity evaluator =====
   - Floating toggle flips <body class="onepct"> into a high-density dark terminal theme.
   - window.OnePct.profile() runs code for honest time/memory: Pyodide perf harness for
     pure-Python (offline), the hft-runner backend for Java and Python Tier-4 work.
   - window.OnePct.estimateComplexity() runs a snippet across input sizes and labels Big-O. */
(function () {
  "use strict";

  var STORE_KEY = "onepct_mode";

  function isOn() { return document.body.classList.contains("onepct"); }

  function setMode(on) {
    document.body.classList.toggle("onepct", on);
    try { localStorage.setItem(STORE_KEY, on ? "1" : "0"); } catch (e) { /* ignore */ }
    var btn = document.getElementById("onepct-toggle");
    if (btn) {
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.textContent = on ? "1% MODE ●" : "1% MODE ○";
    }
  }

  function injectToggle() {
    if (document.getElementById("onepct-toggle")) return;
    var btn = document.createElement("button");
    btn.id = "onepct-toggle";
    btn.type = "button";
    btn.title = "Toggle 1% Assessment Mode — high-density dark terminal";
    btn.addEventListener("click", function () { setMode(!isOn()); });
    document.body.appendChild(btn);
    var saved = "0";
    try { saved = localStorage.getItem(STORE_KEY) || "0"; } catch (e) { /* ignore */ }
    setMode(saved === "1");
  }

  // Run code once and return { ok, stdout, error, timeMs, memKb, source }.
  async function profile(opts) {
    var language = opts.language;
    var code = opts.code;
    var onStatus = opts.onStatus || function () {};
    var preferBackend = !!opts.preferBackend;
    var backendOk = window.HFTRunner && window.HFTRunner.configured();

    if (language === "python" && !preferBackend) {
      var r = await window.PyRunner.runPerf(code, onStatus);
      return Object.assign({ source: "in-browser (Pyodide/WASM)" }, r);
    }
    if (!backendOk) {
      return {
        ok: false, stdout: "", timeMs: null, memKb: null,
        error: "Native profiling needs the execution backend. Set window.HFT_RUNNER_URL in js/runner-config.js.",
        source: "backend (not configured)",
      };
    }
    onStatus("Running on native " + language + "…");
    var res = await window.HFTRunner.run({ language: language, code: code, runtimeFlags: opts.runtimeFlags });
    return {
      ok: res.ok, stdout: res.stdout || "", error: res.stderr || "",
      timeMs: res.timeMs, memKb: res.memKb, source: "native " + language + " (hft-runner)",
    };
  }

  // Format a compact perf badge string.
  function badge(result) {
    var t = result.timeMs == null ? "—" : result.timeMs.toFixed(result.timeMs < 10 ? 3 : 1) + " ms";
    var m = result.memKb == null ? "—" : fmtKb(result.memKb);
    return "⏱ " + t + "  ·  🧮 " + m + "  ·  " + result.source;
  }
  function fmtKb(kb) {
    if (kb < 1024) return Math.round(kb) + " KB";
    return (kb / 1024).toFixed(1) + " MB";
  }

  // Run codeTemplate (with {N}) across sizes, classify growth. Uses profile() per size.
  async function estimateComplexity(opts) {
    var sizes = opts.sizes || [2000, 4000, 8000, 16000, 32000];
    var points = [];
    for (var i = 0; i < sizes.length; i++) {
      var n = sizes[i];
      var code = opts.codeTemplate.replace(/\{N\}/g, String(n));
      var r = await profile({ language: opts.language, code: code, preferBackend: opts.preferBackend, runtimeFlags: opts.runtimeFlags, onStatus: opts.onStatus });
      points.push({ n: n, timeMs: r.timeMs, memKb: r.memKb });
    }
    var fit = window.HFTRunner ? window.HFTRunner.classify(points) : { label: "?", slope: null };
    return { points: points, fit: fit };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectToggle);
  } else {
    injectToggle();
  }

  window.OnePct = { isOn: isOn, setMode: setMode, profile: profile, badge: badge, estimateComplexity: estimateComplexity, fmtKb: fmtKb };
})();
