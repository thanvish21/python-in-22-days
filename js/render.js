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
    const status = el("span", "py-status", "");
    toolbar.appendChild(runBtn);

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

  window.Render = { renderLesson };
})();
