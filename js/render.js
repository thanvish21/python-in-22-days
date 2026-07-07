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
      case "example": return renderExample(b);
      case "assessment": return renderAssessment(b);
      case "recapgame": return renderRecapGame(b);
      case "practice": return renderPractice(b);
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

  function renderExample(b) {
    const wrap = el("div", "block example-card");
    wrap.appendChild(el("h3", null, "🌍 " + escapeInline(b.title || "Real-life example")));
    if (b.scenario) wrap.appendChild(el("div", "instructions", b.scenario));
    if (b.code) wrap.appendChild(makeRunner(b.code, { caption: b.caption || "Run the real-life example" }));
    if (b.explain) wrap.appendChild(el("p", "explain", b.explain));
    return wrap;
  }

  function renderAssessment(b) {
    const questions = (b.questions || []).filter((q) => {
      const options = q.options || [];
      return Number.isInteger(q.answerIndex) && q.answerIndex >= 0 && q.answerIndex < options.length;
    });
    const passPct = Number.isFinite(Number(b.passPct)) ? Number(b.passPct) : 70;
    const wrap = el("div", "block assessment-card");
    wrap.appendChild(el("h3", null, "📝 " + escapeInline(b.title || "Milestone Assessment")));
    if (b.intro) wrap.appendChild(el("p", "assessment-intro", escapeInline(b.intro)));
    wrap.appendChild(el("p", "assessment-note", "Score " + passPct + "% or higher to pass. Choose one answer for each question, then submit."));

    if (!questions.length) {
      wrap.appendChild(el("p", null, "No assessment questions are available yet."));
      return wrap;
    }

    const form = el("div", "test-form assessment-form");
    const picked = new Array(questions.length).fill(-1);
    questions.forEach((q, qi) => {
      const card = el("div", "quiz assessment-question");
      card.appendChild(el("h3", null, "Q" + (qi + 1) + ". " + escapeInline(q.question || "Question")));
      const opts = el("div", "quiz-opts");
      (q.options || []).forEach((text, oi) => {
        const btn = el("button", "quiz-opt", escapeInline(text));
        btn.type = "button";
        btn.addEventListener("click", () => {
          picked[qi] = oi;
          opts.querySelectorAll(".quiz-opt").forEach((x) => x.classList.remove("chosen"));
          btn.classList.add("chosen");
        });
        opts.appendChild(btn);
      });
      card.appendChild(opts);
      form.appendChild(card);
    });
    wrap.appendChild(form);

    const submit = el("button", "complete-btn assessment-submit", "✅ Submit assessment");
    submit.type = "button";
    const result = el("div", "test-result assessment-result");
    submit.addEventListener("click", () => {
      let correct = 0;
      questions.forEach((q, qi) => {
        const card = form.children[qi];
        const opts = card.querySelectorAll(".quiz-opt");
        opts.forEach((o, oi) => {
          o.disabled = true;
          if (oi === q.answerIndex) o.classList.add("correct");
          else if (oi === picked[qi]) o.classList.add("wrong");
        });
        if (picked[qi] === q.answerIndex) correct++;
        if (!card.querySelector(".quiz-explain")) {
          const ex = el("div", "quiz-explain show", q.explain || "");
          card.appendChild(ex);
        }
      });
      const pct = Math.round((correct / questions.length) * 100);
      const pass = pct >= passPct;
      result.className = "test-result assessment-result show " + (pass ? "pass" : "fail");
      result.innerHTML = (pass ? "🎉 " : "📚 ") + "You scored <strong>" + correct + "/" + questions.length +
        " (" + pct + "%)</strong>. " + (pass ? "Passed — you are ready for the next block!" : "Review the explanations above, then try the lesson challenge again.");
      submit.disabled = true;
      result.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    wrap.appendChild(submit);
    wrap.appendChild(result);
    return wrap;
  }

  // ---- practice problems (LeetCode + Codeforces) ----
  function renderPractice(b) {
    const wrap = el("div", "block practice-block");
    wrap.appendChild(el("h3", null, "💪 " + escapeInline(b.title || "Practice on real problems")));
    if (b.intro) wrap.appendChild(el("p", "practice-intro", escapeInline(b.intro)));
    const grid = el("div", "practice-grid");
    (b.problems || []).forEach((p) => {
      const card = el("a", "practice-card");
      card.href = p.url || "#";
      card.target = "_blank";
      card.rel = "noopener";
      const plat = (p.platform || "").toLowerCase();
      const platIcon = plat.includes("leet") ? "🧠" : plat.includes("code") ? "🏆" : plat.includes("hacker") ? "💻" : "🔗";
      const diff = (p.difficulty || "").toLowerCase();
      const diffClass = diff.includes("easy") ? "diff-easy" : diff.includes("med") ? "diff-med" : diff.includes("hard") ? "diff-hard" : "diff-easy";
      card.innerHTML =
        '<div class="practice-plat">' + platIcon + ' ' + escapeInline(p.platform || "Problem") + '</div>' +
        '<div class="practice-title">' + escapeInline(p.title || "Practice Problem") + '</div>' +
        '<div class="practice-meta">' +
          '<span class="practice-diff ' + diffClass + '">' + escapeInline(p.difficulty || "Easy") + '</span>' +
          '<span class="practice-open">Open ↗</span>' +
        '</div>';
      grid.appendChild(card);
    });
    wrap.appendChild(grid);
    if (b.tip) wrap.appendChild(el("p", "practice-tip", "💡 " + escapeInline(b.tip)));
    return wrap;
  }

  // ---- recap games (milestone recap, coddy.tech style) ----
  function shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function renderRecapGame(b) {
    if (b.gameType === "sorter") return renderRecapSorter(b);
    if (b.gameType === "match") return renderRecapMatch(b);
    const wrap = el("div", "block");
    wrap.appendChild(el("p", null, "[unknown recapgame type: " + escapeInline(b.gameType || "?") + "]"));
    return wrap;
  }

  function renderRecapSorter(b) {
    const wrap = el("div", "block recapgame recapgame-sorter");
    wrap.appendChild(el("h3", null, "🎮 " + escapeInline(b.title || "Sort the code")));
    if (b.instructions) wrap.appendChild(el("div", "recap-instructions", escapeInline(b.instructions)));

    const correct = (b.lines || []).map(String);
    const order = shuffleArray(correct.map((_, i) => i));
    // Guarantee starting order isn't already correct (when possible).
    if (correct.length > 1 && order.every((v, i) => v === i)) {
      const tmp = order[0]; order[0] = order[1]; order[1] = tmp;
    }

    const list = el("div", "sorter-list");
    wrap.appendChild(list);

    const toolbar = el("div", "recap-toolbar");
    const checkBtn = el("button", "btn btn-check", "✓ Check Order");
    toolbar.appendChild(checkBtn);
    wrap.appendChild(toolbar);

    const feedback = el("div", "recap-feedback");
    feedback.setAttribute("role", "status");
    feedback.setAttribute("aria-live", "polite");
    wrap.appendChild(feedback);

    function clearFeedback() {
      feedback.className = "recap-feedback";
      feedback.innerHTML = "";
      checkBtn.disabled = false;
    }

    function renderList() {
      list.innerHTML = "";
      order.forEach((idx, pos) => {
        const item = el("div", "sorter-item");
        item.setAttribute("draggable", "true");
        const code = el("pre", "sorter-code");
        code.textContent = correct[idx];
        item.appendChild(code);

        const controls = el("div", "sorter-controls");
        const up = el("button", "sorter-btn", "▲");
        up.setAttribute("aria-label", "Move up");
        up.disabled = pos === 0;
        up.addEventListener("click", () => {
          const t = order[pos - 1]; order[pos - 1] = order[pos]; order[pos] = t;
          clearFeedback();
          renderList();
        });
        const down = el("button", "sorter-btn", "▼");
        down.setAttribute("aria-label", "Move down");
        down.disabled = pos === order.length - 1;
        down.addEventListener("click", () => {
          const t = order[pos + 1]; order[pos + 1] = order[pos]; order[pos] = t;
          clearFeedback();
          renderList();
        });
        controls.appendChild(up);
        controls.appendChild(down);
        item.appendChild(controls);

        // Drag & drop reordering.
        item.addEventListener("dragstart", (e) => {
          item.classList.add("dragging");
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", String(pos));
          }
        });
        item.addEventListener("dragend", () => item.classList.remove("dragging"));
        item.addEventListener("dragover", (e) => {
          e.preventDefault();
          item.classList.add("drag-over");
        });
        item.addEventListener("dragleave", () => item.classList.remove("drag-over"));
        item.addEventListener("drop", (e) => {
          e.preventDefault();
          item.classList.remove("drag-over");
          const from = Number(e.dataTransfer ? e.dataTransfer.getData("text/plain") : NaN);
          if (!Number.isInteger(from) || from === pos) return;
          const [moved] = order.splice(from, 1);
          order.splice(pos, 0, moved);
          clearFeedback();
          renderList();
        });

        list.appendChild(item);
      });
    }
    renderList();

    checkBtn.addEventListener("click", () => {
      const pass = order.every((v, i) => v === i);
      if (pass) {
        feedback.className = "recap-feedback pass show";
        feedback.innerHTML = '<div class="recap-big">✅</div><div class="recap-msg">Perfect order!</div><div class="recap-xp">🏆 +100 XP!</div>';
        checkBtn.disabled = true;
      } else {
        feedback.className = "recap-feedback fail show shake";
        feedback.innerHTML = '<div class="recap-big">❌</div><div class="recap-msg">Not quite — try rearranging.</div>';
        setTimeout(() => feedback.classList.remove("shake"), 600);
      }
    });

    return wrap;
  }

  function renderRecapMatch(b) {
    const wrap = el("div", "block recapgame recapgame-match");
    wrap.appendChild(el("h3", null, "🎮 " + escapeInline(b.title || "Match concepts")));
    if (b.instructions) wrap.appendChild(el("div", "recap-instructions", escapeInline(b.instructions)));

    const pairs = (b.pairs || []).map((p) => ({ left: String(p.left), right: String(p.right) }));
    const rightOrder = shuffleArray(pairs.map((_, i) => i));
    if (pairs.length > 1 && rightOrder.every((v, i) => v === i)) {
      const tmp = rightOrder[0]; rightOrder[0] = rightOrder[1]; rightOrder[1] = tmp;
    }

    const grid = el("div", "match-grid");
    const leftCol = el("div", "match-col");
    const rightCol = el("div", "match-col");
    grid.appendChild(leftCol);
    grid.appendChild(rightCol);
    wrap.appendChild(grid);

    const feedback = el("div", "recap-feedback");
    feedback.setAttribute("role", "status");
    feedback.setAttribute("aria-live", "polite");
    wrap.appendChild(feedback);

    const matched = new Set();
    let selectedLeftIdx = null;
    let selectedLeftBtn = null;

    pairs.forEach((p, i) => {
      const btn = el("button", "match-card match-left", escapeInline(p.left));
      btn.type = "button";
      btn.addEventListener("click", () => {
        if (btn.disabled || matched.has(i)) return;
        if (selectedLeftBtn) selectedLeftBtn.classList.remove("selected");
        selectedLeftIdx = i;
        selectedLeftBtn = btn;
        btn.classList.add("selected");
      });
      leftCol.appendChild(btn);
    });

    rightOrder.forEach((pairIdx) => {
      const btn = el("button", "match-card match-right", escapeInline(pairs[pairIdx].right));
      btn.type = "button";
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        if (selectedLeftIdx === null) {
          btn.classList.add("shake");
          setTimeout(() => btn.classList.remove("shake"), 500);
          return;
        }
        const leftBtnRef = selectedLeftBtn;
        const leftIdxRef = selectedLeftIdx;
        selectedLeftIdx = null;
        selectedLeftBtn = null;

        if (pairIdx === leftIdxRef) {
          matched.add(pairIdx);
          leftBtnRef.classList.remove("selected");
          leftBtnRef.classList.add("correct");
          leftBtnRef.disabled = true;
          btn.classList.add("correct");
          btn.disabled = true;
          if (matched.size === pairs.length) {
            feedback.className = "recap-feedback pass show";
            feedback.innerHTML = '<div class="recap-big">🎉</div><div class="recap-msg">🏆 Perfect Recall! +200 XP</div>';
          }
        } else {
          leftBtnRef.classList.add("wrong", "shake");
          btn.classList.add("wrong", "shake");
          setTimeout(() => {
            leftBtnRef.classList.remove("wrong", "shake", "selected");
            btn.classList.remove("wrong", "shake");
          }, 600);
        }
      });
      rightCol.appendChild(btn);
    });

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
