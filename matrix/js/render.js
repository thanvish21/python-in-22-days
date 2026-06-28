/* ===== render.js — turns a lesson JSON object into interactive DOM ===== */
(function () {
  "use strict";

  // ---- tiny DOM helpers ----
  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  // Attach a runnable code box. `editable` makes it a try-it editor.
  function makeRunner(code, opts) {
    opts = opts || {};
    const card = el("div", "code-card");
    if (opts.caption) card.appendChild(el("div", "code-caption", opts.caption));

    let input;
    if (opts.editable) {
      input = el("textarea", "code-area");
      input.value = code;
      input.rows = Math.min(16, Math.max(3, code.split("\n").length + 1));
      input.spellcheck = false;
      // Tab inserts spaces instead of moving focus.
      input.addEventListener("keydown", (e) => {
        if (e.key === "Tab") {
          e.preventDefault();
          const s = input.selectionStart, en = input.selectionEnd;
          input.value = input.value.slice(0, s) + "    " + input.value.slice(en);
          input.selectionStart = input.selectionEnd = s + 4;
        }
      });
      card.appendChild(input);
    } else {
      const pre = el("pre", "code-static");
      pre.textContent = code;
      card.appendChild(pre);
    }

    const toolbar = el("div", "code-toolbar");
    const runBtn = el("button", "btn btn-run", "▶ Run");
    const profBtn = el("button", "btn btn-soft", "⏱ Profile");
    const status = el("span", "py-status", "");
    toolbar.appendChild(runBtn);
    toolbar.appendChild(profBtn);

    let checkBtn, solBtn, feedback;
    if (opts.check || opts.solution) {
      if (opts.check) {
        checkBtn = el("button", "btn btn-check", "✓ Check");
        toolbar.appendChild(checkBtn);
      }
      if (opts.solution) {
        solBtn = el("button", "btn btn-soft", "💡 Show solution");
        toolbar.appendChild(solBtn);
      }
    }
    toolbar.appendChild(status);
    card.appendChild(toolbar);

    const out = el("div", "run-out");
    out.setAttribute("role", "status");
    out.setAttribute("aria-live", "polite");
    card.appendChild(out);
    const perfBadge = el("div", "perf-badge");
    card.appendChild(perfBadge);
    if (opts.check) {
      feedback = el("div", "feedback");
      feedback.setAttribute("role", "status");
      feedback.setAttribute("aria-live", "polite");
      card.appendChild(feedback);
    }

    const getCode = () => (input ? input.value : code);

    async function doRun() {
      runBtn.disabled = true;
      status.innerHTML = '<span class="spinner"></span>';
      const res = await window.PyRunner.run(getCode(), (m) => { status.textContent = m; });
      status.textContent = "";
      runBtn.disabled = false;
      out.classList.add("show");
      if (res.ok) {
        out.innerHTML = res.stdout.trim()
          ? escapeHtml(res.stdout)
          : '<span class="ok-tag">✓ Ran with no output</span>';
      } else {
        out.innerHTML = (res.stdout ? escapeHtml(res.stdout) : "") +
          '<span class="err">' + escapeHtml(res.error) + "</span>";
      }
      return res;
    }
    runBtn.addEventListener("click", doRun);

    // Profile: honest time + peak memory. Pyodide harness for pure-Python (offline),
    // hft-runner backend for Tier-4 (multiprocessing / native) when configured.
    profBtn.addEventListener("click", async () => {
      profBtn.disabled = true;
      status.innerHTML = '<span class="spinner"></span>';
      const r = await window.OnePct.profile({
        language: "python",
        code: getCode(),
        preferBackend: !!opts.preferBackend,
        runtimeFlags: opts.runtimeFlags,
        onStatus: (m) => { status.textContent = m; },
      });
      status.textContent = "";
      profBtn.disabled = false;
      out.classList.add("show");
      out.innerHTML = r.ok
        ? (r.stdout && r.stdout.trim() ? escapeHtml(r.stdout) : '<span class="ok-tag">✓ Ran with no output</span>')
        : '<span class="err">' + escapeHtml(r.error || "Run failed") + "</span>";
      perfBadge.textContent = r.timeMs != null ? window.OnePct.badge(r) : "";
    });

    if (checkBtn) {
      checkBtn.addEventListener("click", async () => {
        const res = await doRun();
        const pass = evaluateCheck(opts.check, res, getCode());
        feedback.className = "feedback show " + (pass ? "pass" : "fail");
        feedback.textContent = pass
          ? "🎉 " + (opts.passMsg || "Perfect! That works!")
          : "🤔 " + (opts.failMsg || "Not quite — peek at the hint or solution and try again.");
      });
    }
    if (solBtn) {
      solBtn.addEventListener("click", () => {
        if (input) { input.value = opts.solution; input.rows = Math.min(16, opts.solution.split("\n").length + 1); }
        solBtn.textContent = "✓ Solution loaded — press Run";
        solBtn.disabled = true;
      });
    }
    return card;
  }

  // Decide pass/fail from a check spec against run output.
  function evaluateCheck(check, res, code) {
    if (!res.ok) return false;
    const out = (res.stdout || "").trim();
    if (check.stdout_equals != null) return out === String(check.stdout_equals).trim();
    if (check.stdout_includes != null) {
      const needles = Array.isArray(check.stdout_includes) ? check.stdout_includes : [check.stdout_includes];
      return needles.every((n) => out.includes(String(n)));
    }
    if (check.code_includes != null) {
      const needles = Array.isArray(check.code_includes) ? check.code_includes : [check.code_includes];
      return needles.every((n) => code.includes(String(n)));
    }
    if (check.regex != null) return new RegExp(check.regex, "m").test(out);
    return res.ok; // fallback: ran cleanly
  }

  function escapeHtml(s) {
    return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  }

  // ---- block renderers ----
  function renderBlock(b) {
    switch (b.type) {
      case "text": {
        const wrap = el("div", "block");
        if (b.heading) wrap.appendChild(el("h2", null, escapeInline(b.heading)));
        wrap.appendChild(el("div", null, b.html || ""));
        return wrap;
      }
      case "code": {
        const wrap = el("div", "block");
        if (b.expectError) {
          const note = el("div", "tip warn");
          note.appendChild(el("span", "tip-emoji", "🧪"));
          note.appendChild(el("div", null, "<strong>This one breaks on purpose!</strong> Run it and read the red error — learning to read errors is a superpower."));
          wrap.appendChild(note);
        }
        wrap.appendChild(makeRunner(b.code, { caption: b.caption || "Run this 👇", editable: !!b.editable }));
        if (b.explain) wrap.appendChild(el("p", "explain", b.explain));
        return wrap;
      }
      case "tryit": {
        const wrap = el("div", "block tryit");
        wrap.appendChild(el("h3", null, "🛠️ " + (b.title || "Your turn!")));
        wrap.appendChild(el("div", "instructions", b.instructions || ""));
        wrap.appendChild(makeRunner(b.starter || "", {
          editable: true, check: b.check, solution: b.solution,
          caption: "Edit, then Run or Check", passMsg: b.passMsg, failMsg: b.failMsg,
        }));
        return wrap;
      }
      case "quiz": return renderQuiz(b);
      case "surprise": return renderSurprise(b);
      case "tip": {
        const wrap = el("div", "block");
        const box = el("div", "tip" + (b.variant === "warn" ? " warn" : ""));
        box.appendChild(el("span", "tip-emoji", b.variant === "warn" ? "⚠️" : "💡"));
        box.appendChild(el("div", null, b.html || ""));
        wrap.appendChild(box);
        return wrap;
      }
      default: {
        const wrap = el("div", "block");
        wrap.appendChild(el("p", null, "[unknown block: " + escapeInline(b.type || "?") + "]"));
        return wrap;
      }
    }
  }

  // Render one interactive quiz question (shape: {question, options, answerIndex, explain}).
  function renderQuizQuestion(q) {
    const wrap = el("div", "block quiz");
    wrap.appendChild(el("h3", null, "❓ " + (q.question || "Quick check")));
    const opts = el("div", "quiz-opts");
    let answered = false;
    const explain = el("div", "quiz-explain", q.explain || "");
    (q.options || []).forEach((text, i) => {
      const btn = el("button", "quiz-opt", escapeInline(text));
      btn.addEventListener("click", () => {
        if (answered) return;
        answered = true;
        const correct = i === q.answerIndex;
        btn.classList.add(correct ? "correct" : "wrong");
        btn.appendChild(el("span", "quiz-mark", correct ? " ✓" : " ✗"));
        if (!correct) {
          const right = opts.children[q.answerIndex];
          if (right) { right.classList.add("correct"); right.appendChild(el("span", "quiz-mark", " ✓")); }
        }
        explain.classList.add("show");
      });
      opts.appendChild(btn);
    });
    wrap.appendChild(opts);
    wrap.appendChild(explain);
    return wrap;
  }

  function renderQuiz(b) {
    return renderQuizQuestion(b);
  }

  function renderSurprise(b) {
    const wrap = el("div", "block surprise-quiz");
    wrap.appendChild(el("h3", null, "🎁 " + escapeInline(b.title || "Surprise Quiz!")));
    if (b.intro) wrap.appendChild(el("p", "surprise-intro", escapeInline(b.intro)));
    (b.questions || []).forEach((q) => wrap.appendChild(renderQuizQuestion(q)));
    return wrap;
  }

  function escapeInline(s) { return String(s).replace(/[<>]/g, (c) => ({ "<": "&lt;", ">": "&gt;" }[c])); }

  // ---- full lesson ----
  function renderLesson(data) {
    const root = el("div", "lesson");

    const head = el("div", "lesson-head");
    head.appendChild(el("div", "crumbs", '<a href="#/">🏠 Home</a> &nbsp;›&nbsp; Day ' + data.day + " of 22"));
    head.appendChild(el("div", "day-emoji", '<span style="font-size:40px">' + (data.emoji || "🐍") + "</span>"));
    head.appendChild(el("h1", null, "Day " + data.day + ": " + escapeInline(data.title)));
    if (data.subtitle) head.appendChild(el("div", "subtitle", escapeInline(data.subtitle)));
    const meta = el("div", "lesson-meta");
    meta.appendChild(el("span", "pill", "⏱️ ~" + (data.estMinutes || 180) + " min"));
    (data.tags || []).forEach((t) => meta.appendChild(el("span", "pill", "#" + t)));
    head.appendChild(meta);
    root.appendChild(head);

    if (data.goal) {
      const goal = el("div", "goal-box");
      goal.appendChild(el("span", "goal-emoji", "🎯"));
      goal.appendChild(el("div", null, "<strong>Today's goal:</strong> " + escapeInline(data.goal)));
      root.appendChild(goal);
    }

    (data.blocks || []).forEach((b) => root.appendChild(renderBlock(b)));

    if (data.challenge) {
      const c = data.challenge;
      const box = el("div", "block challenge");
      box.appendChild(el("h3", null, "🏆 " + (c.title || "Day Challenge")));
      box.appendChild(el("div", "instructions", c.instructions || ""));
      box.appendChild(makeRunner(c.starter || "", {
        editable: true, check: c.check, solution: c.solution,
        caption: "Build it here", passMsg: c.passMsg || "🏆 Challenge complete — you crushed it!",
        failMsg: c.failMsg || "Almost! Re-read the steps and try again.",
      }));
      if (c.hint) {
        const tip = el("div", "tip");
        tip.appendChild(el("span", "tip-emoji", "💡"));
        tip.appendChild(el("div", null, "<strong>Hint:</strong> " + c.hint));
        box.appendChild(tip);
      }
      root.appendChild(box);
    }
    return root;
  }

  // ===== 1% HFT Matrix — tier rendering =====

  // Compare actual stdout to expected per matchMode (exact|trim|includes|regex).
  function matchOutput(actual, expected, mode) {
    const a = actual == null ? "" : String(actual);
    const e = expected == null ? "" : String(expected);
    switch (mode) {
      case "exact": return a === e;
      case "includes": return a.includes(e);
      case "regex": return new RegExp(e, "m").test(a);
      case "trim":
      default: return a.trim() === e.trim();
    }
  }

  // Build one graded problem card: editor + Run / Profile / Grade / Solution / Complexity.
  // `p` is a problems[] entry; `engine` is the tier/problem engine ("pyodide"|"backend").
  // `opts.isMastered(id)` / `opts.onMastered(id)` persist per-problem mastery.
  function makeProblemCard(p, opts) {
    opts = opts || {};
    const engine = p.engine || "pyodide";
    const isBackend = engine === "backend";
    const card = el("div", "problem-card");
    if (p.id && opts.isMastered && opts.isMastered(p.id)) card.classList.add("mastered");

    const headRow = el("div", "problem-head");
    headRow.appendChild(el("span", "problem-title", escapeInline(p.title || p.id || "Problem")));
    if (p.difficulty) headRow.appendChild(el("span", "diff-pill diff-" + escapeInline(p.difficulty), escapeInline(p.difficulty)));
    headRow.appendChild(el("span", "engine-pill", isBackend ? "backend" : "pyodide"));
    const masterBadge = el("span", "master-badge", "✓ mastered");
    headRow.appendChild(masterBadge);
    card.appendChild(headRow);

    function flagMastered() {
      card.classList.add("mastered");
      if (p.id && opts.onMastered) opts.onMastered(p.id);
    }

    if (p.instructions) card.appendChild(el("div", "instructions", p.instructions));

    const input = el("textarea", "code-area");
    input.value = p.starter || "";
    input.rows = Math.min(24, Math.max(4, (p.starter || "").split("\n").length + 1));
    input.spellcheck = false;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const s = input.selectionStart, en = input.selectionEnd;
        input.value = input.value.slice(0, s) + "    " + input.value.slice(en);
        input.selectionStart = input.selectionEnd = s + 4;
      }
    });
    card.appendChild(input);

    const toolbar = el("div", "code-toolbar");
    const runBtn = el("button", "btn btn-run", "▶ Run");
    const profBtn = el("button", "btn btn-soft", "⏱ Profile");
    const gradeBtn = el("button", "btn btn-check", "✓ Grade");
    const solBtn = el("button", "btn btn-soft", "💡 Solution");
    const status = el("span", "py-status", "");
    toolbar.appendChild(runBtn);
    toolbar.appendChild(profBtn);
    toolbar.appendChild(gradeBtn);
    toolbar.appendChild(solBtn);
    let cxBtn = null;
    if (p.complexity) {
      cxBtn = el("button", "btn btn-soft", "📈 Complexity");
      toolbar.appendChild(cxBtn);
    }
    toolbar.appendChild(status);
    card.appendChild(toolbar);

    const out = el("div", "run-out");
    out.setAttribute("role", "status");
    out.setAttribute("aria-live", "polite");
    card.appendChild(out);
    const perfBadge = el("div", "perf-badge");
    card.appendChild(perfBadge);
    const grade = el("div", "grade-out");
    card.appendChild(grade);
    const cxOut = el("div", "complexity-out");
    card.appendChild(cxOut);

    const getCode = () => input.value;
    const busy = (b) => { runBtn.disabled = profBtn.disabled = gradeBtn.disabled = b; if (cxBtn) cxBtn.disabled = b; };
    const backendReady = () => window.HFTRunner && window.HFTRunner.configured();

    function showOut(res) {
      out.classList.add("show");
      if (res.ok) {
        out.innerHTML = (res.stdout && res.stdout.trim())
          ? escapeHtml(res.stdout)
          : '<span class="ok-tag">✓ Ran with no output</span>';
      } else {
        out.innerHTML = (res.stdout ? escapeHtml(res.stdout) : "") +
          '<span class="err">' + escapeHtml(res.error || "Run failed") + "</span>";
      }
    }

    // ---- Run ----
    runBtn.addEventListener("click", async () => {
      busy(true);
      status.innerHTML = '<span class="spinner"></span>';
      let res;
      if (isBackend) {
        if (!backendReady()) {
          status.textContent = "";
          busy(false);
          out.classList.add("show");
          out.innerHTML = '<span class="err">Tier 4 runs on the execution backend. Set window.HFT_RUNNER_URL in js/runner-config.js to enable Run/Grade.</span>';
          return;
        }
        const r = await window.HFTRunner.run({ language: p.language || "python", code: getCode(), runtimeFlags: p.runtimeFlags || [], stdin: p.stdin || "" });
        res = { ok: r.ok !== false && !r.stderr, stdout: r.stdout || "", error: r.stderr || "" };
      } else {
        res = await window.PyRunner.runWithInput(getCode(), p.stdin || "");
      }
      status.textContent = "";
      busy(false);
      showOut(res);
    });

    // ---- Profile ----
    profBtn.addEventListener("click", async () => {
      busy(true);
      status.innerHTML = '<span class="spinner"></span>';
      const r = await window.OnePct.profile({
        language: p.language || "python",
        code: getCode(),
        preferBackend: isBackend,
        runtimeFlags: p.runtimeFlags || [],
        onStatus: (m) => { status.textContent = m; },
      });
      status.textContent = "";
      busy(false);
      showOut(r);
      perfBadge.textContent = r.timeMs != null ? window.OnePct.badge(r) : "";
    });

    // ---- Grade ----
    gradeBtn.addEventListener("click", async () => {
      busy(true);
      status.innerHTML = '<span class="spinner"></span>';
      grade.className = "grade-out show";
      grade.innerHTML = "Grading…";
      const tests = p.tests || [];
      if (isBackend) {
        if (!backendReady()) {
          status.textContent = "";
          busy(false);
          grade.className = "grade-out show fail";
          grade.innerHTML = "Backend not configured — set window.HFT_RUNNER_URL to grade Tier 4 problems.";
          return;
        }
        const r = await window.HFTRunner.grade({ language: p.language || "python", code: getCode(), runtimeFlags: p.runtimeFlags || [], tests });
        status.textContent = "";
        busy(false);
        renderBackendGrade(grade, r);
        if (r && r.allPassed) flagMastered();
      } else {
        const code = getCode();
        let passed = 0;
        const rows = [];
        for (const t of tests) {
          const res = await window.PyRunner.runWithInput(code, t.stdin || "");
          const ok = res.ok && matchOutput(res.stdout, t.expectStdout, t.matchMode || "trim");
          if (ok) passed++;
          rows.push({ t, ok, res });
        }
        status.textContent = "";
        busy(false);
        renderPyodideGrade(grade, rows, passed, tests.length, p);
        if (tests.length > 0 && passed === tests.length) flagMastered();
      }
    });

    // ---- Solution ----
    let solShown = false;
    solBtn.addEventListener("click", () => {
      if (!p.solution) { solBtn.textContent = "No solution provided"; solBtn.disabled = true; return; }
      if (!solShown) {
        input.dataset.userCode = input.value;
        input.value = p.solution;
        input.rows = Math.min(24, Math.max(4, p.solution.split("\n").length + 1));
        solBtn.textContent = "↩ Restore my code";
        solShown = true;
      } else {
        input.value = input.dataset.userCode || p.starter || "";
        input.rows = Math.min(24, Math.max(4, input.value.split("\n").length + 1));
        solBtn.textContent = "💡 Solution";
        solShown = false;
      }
    });

    // ---- Complexity ----
    if (cxBtn) {
      cxBtn.addEventListener("click", async () => {
        busy(true);
        status.innerHTML = '<span class="spinner"></span>';
        cxOut.className = "complexity-out show";
        cxOut.innerHTML = "Measuring growth across input sizes…";
        const cx = p.complexity || {};
        const r = await window.OnePct.estimateComplexity({
          language: p.language || "python",
          codeTemplate: cx.codeTemplate,
          sizes: cx.sizes,
          preferBackend: isBackend,
          runtimeFlags: p.runtimeFlags || [],
          onStatus: (m) => { status.textContent = m; },
        });
        status.textContent = "";
        busy(false);
        renderComplexity(cxOut, r, cx.expected);
      });
    }

    return card;
  }

  function renderPyodideGrade(node, rows, passed, total, p) {
    const allPassed = total > 0 && passed === total;
    node.className = "grade-out show " + (allPassed ? "pass" : (passed > 0 ? "partial" : "fail"));
    let html = '<div class="grade-summary">' + (allPassed ? "✓ " : "") + passed + " / " + total + " tests passed" +
      (allPassed ? " — mastery achieved" : "") + "</div>";
    rows.forEach(({ t, ok, res }) => {
      const cls = ok ? "pass" : "fail";
      if (t.hidden) {
        html += '<div class="test-row ' + cls + ' hidden">' + (ok ? "✓" : "✗") + " " +
          escapeInline(t.name || "hidden test") + ' <span class="hidden-tag">hidden</span></div>';
      } else {
        html += '<div class="test-row ' + cls + '">' + (ok ? "✓" : "✗") + " " + escapeInline(t.name || "test");
        if (!ok) {
          html += '<div class="test-detail">expected: <code>' + escapeHtml(String(t.expectStdout == null ? "" : t.expectStdout)).slice(0, 400) +
            '</code><br>got: <code>' + escapeHtml(res.ok ? (res.stdout || "") : (res.error || "")).slice(0, 400) + "</code></div>";
        }
        html += "</div>";
      }
    });
    if (!allPassed && p && p.hint) html += '<div class="grade-hint">💡 ' + escapeInline(p.hint) + "</div>";
    node.innerHTML = html;
  }

  function renderBackendGrade(node, r) {
    const allPassed = !!r.allPassed;
    node.className = "grade-out show " + (allPassed ? "pass" : ((r.passed || 0) > 0 ? "partial" : "fail"));
    let html = '<div class="grade-summary">' + (allPassed ? "✓ " : "") + (r.passed || 0) + " / " + (r.total || 0) +
      " tests passed" + (allPassed ? " — mastery achieved" : "") + "</div>";
    (r.results || []).forEach((res) => {
      const cls = res.ok ? "pass" : "fail";
      const meta = (res.timeMs != null ? " · " + res.timeMs + " ms" : "") + (res.memKb != null ? " · " + window.OnePct.fmtKb(res.memKb) : "");
      html += '<div class="test-row ' + cls + (res.hidden ? " hidden" : "") + '">' + (res.ok ? "✓" : "✗") + " " +
        escapeInline(res.name || "test") + (res.hidden ? ' <span class="hidden-tag">hidden</span>' : "") +
        '<span class="test-meta">' + meta + "</span></div>";
    });
    node.innerHTML = html;
  }

  function renderComplexity(node, r, expected) {
    node.className = "complexity-out show";
    const pts = r.points || [];
    const fit = r.fit || { label: "?" };
    let html = '<table class="perf-table"><thead><tr><th>n</th><th>time (ms)</th><th>mem</th></tr></thead><tbody>';
    pts.forEach((pt) => {
      html += "<tr><td>" + pt.n + "</td><td>" + (pt.timeMs == null ? "—" : pt.timeMs.toFixed(pt.timeMs < 10 ? 3 : 1)) +
        "</td><td>" + (pt.memKb == null ? "—" : window.OnePct.fmtKb(pt.memKb)) + "</td></tr>";
    });
    html += "</tbody></table>";
    html += '<div class="complexity-fit">measured: <span class="perf-bigo">' + escapeInline(fit.label) + "</span>" +
      (fit.slope != null ? ' <span class="cx-slope">(slope ' + fit.slope + ")</span>" : "");
    if (expected) html += '  ·  expected: <span class="perf-bigo">' + escapeInline(expected) + "</span>";
    html += "</div>";
    node.innerHTML = html;
  }

  // ---- full tier ----
  function renderTier(data, opts) {
    opts = opts || {};
    const root = el("div", "lesson tier-view");

    const head = el("div", "lesson-head tier-head");
    head.appendChild(el("div", "crumbs", '<a href="#/">⌂ Matrix</a> &nbsp;›&nbsp; Tier ' + data.tier));
    head.appendChild(el("div", "tier-emoji", '<span style="font-size:40px">' + (data.emoji || "⚡") + "</span>"));
    head.appendChild(el("h1", null, "Tier " + data.tier + ": " + escapeInline(data.title)));
    if (data.subtitle) head.appendChild(el("div", "subtitle", escapeInline(data.subtitle)));
    const meta = el("div", "lesson-meta");
    meta.appendChild(el("span", "pill", "⏱ ~" + (data.estMinutes || 240) + " min"));
    meta.appendChild(el("span", "pill", "engine: " + (data.tier === 4 ? "backend" : "pyodide")));
    (data.tags || []).forEach((t) => meta.appendChild(el("span", "pill", "#" + t)));
    head.appendChild(meta);
    root.appendChild(head);

    if (data.goal) {
      const goal = el("div", "goal-box");
      goal.appendChild(el("span", "goal-emoji", "🎯"));
      goal.appendChild(el("div", null, "<strong>Mastery goal:</strong> " + escapeInline(data.goal)));
      root.appendChild(goal);
    }

    (data.blocks || []).forEach((b) => root.appendChild(renderBlock(b)));

    const problems = data.problems || [];
    if (problems.length) {
      const sec = el("h2", "section-title", "🏁 Graded Problems (" + problems.length + ")");
      root.appendChild(sec);
      problems.forEach((p) => root.appendChild(makeProblemCard(p, opts)));
    }

    return root;
  }

  window.Render = { renderLesson, renderTier };
})();
