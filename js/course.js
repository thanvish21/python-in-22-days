/* ===== course.js — PCEP module view, collapsible outline sidebar,
   module tests, and exam-prep page. Layers on top of the 22-day lessons. ===== */
(function () {
  "use strict";

  const PASS_PCT = 70; // PCEP passing score
  let course = null;        // cached modules.json
  let dayTitles = null;     // cached manifest (day -> {title,emoji})
  const expanded = {};      // which modules are open in the sidebar

  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function escapeHtml(s) {
    return String(s).replace(/[<>]/g, (c) => ({ "<": "&lt;", ">": "&gt;" }[c]));
  }

  async function getCourse() {
    if (course) return course;
    try {
      const res = await fetch("data/modules.json");
      if (!res.ok) throw new Error("modules.json " + res.status);
      course = await res.json();
      return course;
    } catch (e) {
      throw new Error("Could not load course modules. Run this on a server (see README).");
    }
  }
  async function getDayTitles() {
    if (dayTitles) return dayTitles;
    try {
      const list = await window.Py22.getManifest();
      const titles = {};
      list.forEach((d) => { titles[d.day] = d; });
      dayTitles = titles;
      return dayTitles;
    } catch (e) {
      throw new Error("Could not load lesson list. Run this on a server (see README).");
    }
  }

  // status of a single day: done | current | open | locked
  function dayStatus(day) {
    const P = window.Py22;
    if (P.isDone(day)) return "done";
    if (!P.isUnlocked(day)) return "locked";
    return P.lastDay() === day ? "current" : "open";
  }
  const STATUS_ICON = { done: "✓", current: "◐", open: "○", locked: "🔒" };

  function moduleProgress(mod) {
    const done = mod.days.filter((d) => window.Py22.isDone(d)).length;
    const total = mod.days.length;
    return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
  }

  // ---------- Sidebar ----------
  async function buildSidebar() {
    const sb = document.getElementById("sidebar");
    if (!sb) return;
    const [c, titles] = [await getCourse(), await getDayTitles()];

    const wrap = el("div", "sb-inner");
    wrap.appendChild(el("div", "sb-title", "📘 Course Outline"));

    const search = el("input", "sb-search");
    search.type = "search";
    search.placeholder = "Search lessons…";
    wrap.appendChild(search);

    const list = el("div", "sb-modules");
    c.modules.forEach((mod) => {
      const prog = moduleProgress(mod);
      const isOpen = expanded[mod.id] !== undefined ? expanded[mod.id] : (prog.done > 0 && prog.pct < 100) || mod.id === 1;

      const modBox = el("div", "sb-mod");
      const head = el("button", "sb-mod-head" + (isOpen ? " open" : ""));
      head.innerHTML =
        '<span class="sb-caret">▸</span>' +
        '<span class="sb-mod-title">Module ' + mod.id + (mod.bonus ? " ⭐" : "") + ": " + mod.title + "</span>" +
        '<span class="sb-mod-pct">' + prog.pct + "%</span>";
      const body = el("div", "sb-mod-body" + (isOpen ? " open" : ""));

      mod.days.forEach((day) => {
        const st = dayStatus(day);
        const t = titles[day] || { title: "Day " + day, emoji: "📄" };
        const item = el(st === "locked" ? "div" : "a", "sb-lesson st-" + st + (location.hash === "#/day/" + day ? " active" : ""));
        if (st !== "locked") item.href = "#/day/" + day;
        item.innerHTML = '<span class="sb-ic">' + STATUS_ICON[st] + "</span>" +
          '<span class="sb-ltext">' + t.emoji + " Day " + day + ": " + t.title + "</span>";
        item.dataset.search = ("day " + day + " " + t.title).toLowerCase();
        body.appendChild(item);
      });

      // module test entry
      const test = el("a", "sb-lesson sb-test");
      test.href = "#/test/" + mod.id;
      test.innerHTML = '<span class="sb-ic">📝</span><span class="sb-ltext">Module ' + mod.id + " Test</span>";
      test.dataset.search = ("module test " + mod.id).toLowerCase();
      body.appendChild(test);

      head.addEventListener("click", () => {
        const nowOpen = !body.classList.contains("open");
        expanded[mod.id] = nowOpen;
        body.classList.toggle("open", nowOpen);
        head.classList.toggle("open", nowOpen);
      });

      modBox.appendChild(head);
      modBox.appendChild(body);
      list.appendChild(modBox);
    });
    wrap.appendChild(list);

    // Final project + exam shortcuts
    const extra = el("div", "sb-extra");
    const fp = el("a", "sb-lesson sb-test");
    fp.href = "#/day/" + c.finalProjectDay;
    fp.innerHTML = '<span class="sb-ic">🏁</span><span class="sb-ltext">Final Project (Day ' + c.finalProjectDay + ")</span>";
    const ex = el("a", "sb-lesson sb-test");
    ex.href = "#/exam";
    ex.innerHTML = '<span class="sb-ic">🎓</span><span class="sb-ltext">' + c.exam.code + " Exam Prep</span>";
    extra.appendChild(fp);
    extra.appendChild(ex);
    wrap.appendChild(extra);

    // live filter
    search.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      wrap.querySelectorAll(".sb-lesson").forEach((it) => {
        const hit = !q || (it.dataset.search || "").includes(q);
        it.style.display = hit ? "" : "none";
      });
      // open all modules while searching
      if (q) wrap.querySelectorAll(".sb-mod-body, .sb-mod-head").forEach((b) => b.classList.add("open"));
    });

    sb.innerHTML = "";
    sb.appendChild(wrap);
  }

  function setSidebarOpen(open) {
    document.getElementById("sidebar").classList.toggle("open", open);
    document.getElementById("backdrop").classList.toggle("show", open);
    const toggle = document.getElementById("outlineToggle");
    if (toggle) toggle.setAttribute("aria-expanded", open ? "true" : "false");
  }
  function syncSidebar() {
    buildSidebar(); // rebuild to reflect progress + active lesson
  }

  // ---------- Modules overview view ----------
  async function viewModules(app) {
    app.innerHTML = '<div class="center-msg">Loading modules…</div>';
    let c, titles;
    try { [c, titles] = [await getCourse(), await getDayTitles()]; }
    catch (e) { app.innerHTML = '<div class="center-msg">' + escapeHtml(e.message) + '</div>'; return; }

    const root = el("div", "modules-view");
    root.appendChild(el("div", "crumbs", '<a href="#/">🏠 Home</a> &nbsp;›&nbsp; Course Modules'));
    root.appendChild(el("h1", "section-title", "📚 Course Modules"));
    root.appendChild(el("p", "lead", "Your 22 days, grouped the way the official <strong>Cisco Python Essentials 1</strong> course maps to the <strong>" + c.exam.code + "</strong> certification. Work day by day, or jump to a module test."));

    c.modules.forEach((mod) => {
      const prog = moduleProgress(mod);
      const card = el("div", "mod-card");
      const deg = Math.round(prog.pct * 3.6);
      card.appendChild(el("div", "mod-card-head",
        "<div><div class=\"mod-kicker\">Module " + mod.id + (mod.bonus ? " · Bonus ⭐" : "") + "</div>" +
        '<h2>' + mod.title + "</h2></div>" +
        '<div class="mod-ring" style="background:conic-gradient(var(--brand) ' + deg + 'deg, #efe9ff 0)">' + prog.pct + "%</div>"));
      card.appendChild(el("p", "mod-summary", mod.summary));

      const days = el("div", "mod-days");
      mod.days.forEach((day) => {
        const st = dayStatus(day);
        const t = titles[day] || { title: "Day " + day, emoji: "📄" };
        const d = el(st === "locked" ? "div" : "a", "mod-day st-" + st);
        if (st !== "locked") d.href = "#/day/" + day;
        d.innerHTML = '<span class="sb-ic">' + STATUS_ICON[st] + "</span> " + t.emoji + " Day " + day + ": " + t.title;
        days.appendChild(d);
      });
      card.appendChild(days);

      const test = el("a", "mod-test-btn");
      test.href = "#/test/" + mod.id;
      test.textContent = "📝 Take Module " + mod.id + " Test";
      card.appendChild(test);
      root.appendChild(card);
    });

    const examBtn = el("a", "hero-cta");
    examBtn.href = "#/exam";
    examBtn.textContent = "🎓 See the " + c.exam.code + " exam map";
    examBtn.style.marginTop = "10px";
    root.appendChild(examBtn);

    app.innerHTML = "";
    app.appendChild(root);
    window.scrollTo(0, 0);
  }

  // ---------- Module test (aggregates quizzes from the module's days) ----------
  async function viewModuleTest(app, moduleId) {
    app.innerHTML = '<div class="center-msg">Building your test…</div>';
    let c;
    try { c = await getCourse(); }
    catch (e) { app.innerHTML = '<div class="center-msg">' + escapeHtml(e.message) + '</div>'; return; }
    const mod = c.modules.find((m) => m.id === moduleId);
    if (!mod) { app.innerHTML = '<div class="center-msg">Test not found. <a href="#/modules">Back to modules</a></div>'; return; }

    // pull quiz blocks from each day in the module
    const questions = [];
    for (const day of mod.days) {
      try {
        const lesson = await window.Py22.getLesson(day);
        (lesson.blocks || []).filter((b) => b.type === "quiz").forEach((q) => {
          const options = q.options || [];
          if (!Number.isInteger(q.answerIndex) || q.answerIndex < 0 || q.answerIndex >= options.length) return;
          questions.push({ day, question: q.question, options, answerIndex: q.answerIndex, explain: q.explain });
        });
      } catch (e) { /* day not written yet */ }
    }

    const coding = mod.coding || [];
    const testMinutes = c.testMinutes || 30;
    const root = el("div", "test-view");
    root.appendChild(el("div", "crumbs", '<a href="#/modules">📚 Modules</a> &nbsp;›&nbsp; Module ' + mod.id + " Test"));
    root.appendChild(el("h1", null, "📝 Module " + mod.id + " Test"));

    let isGating = false;
    if (window.Py22 && (window.Py22 && window.Py22.GATES)) {
      isGating = Object.values((window.Py22 && window.Py22.GATES)).includes(mod.id);
    }

    root.appendChild(el("p", "lead", mod.title + " — " +
      (coding.length ? coding.length + " coding tasks" : "No coding tasks available.") +
      ". ⏱️ " + testMinutes + " minutes. Score " + PASS_PCT + "% or higher to pass" +
      (isGating ? " and unlock the next days." : ".")));

    // ---- 30-min countdown; auto-submits on zero ----
    const timer = el("div", "test-timer", "⏱️ " + testMinutes + ":00");
    timer.style.cssText = "position:sticky;top:8px;z-index:5;display:inline-block;padding:6px 14px;border-radius:20px;background:var(--brand,#7c4dff);color:#fff;font-weight:700;";
    root.appendChild(timer);
    let secsLeft = testMinutes * 60;
    let submitted = false;
    let tick;

    function updateTimer() {
      if (submitted) return;
      secsLeft--;
      const m = Math.floor(secsLeft / 60), s = secsLeft % 60;
      timer.textContent = "⏱️ " + m + ":" + String(s).padStart(2, "0");
      if (secsLeft <= 60) timer.style.background = "#e53935";
      if (secsLeft <= 0) { clearInterval(tick); if (!submitted) doSubmit(true); }
    }

    tick = setInterval(updateTimer, 1000);
    window.addEventListener("hashchange", () => clearInterval(tick), { once: true });

    if (!coding.length) {
      root.appendChild(el("p", null, "No coding tasks available yet for this module."));
      app.innerHTML = ""; app.appendChild(root); return;
    }

    const form = el("div", "test-form");

    // ---- render coding challenges ----
    const codingState = coding.map(() => ({ pass: false, out: "" }));
    coding.forEach((task, ci) => {
      const card = el("div", "quiz coding-task");
      card.appendChild(el("h3", null, "C" + (ci + 1) + ". " + escapeHtml(task.prompt)));

      const editorArea = el("div", "try-box");
      const ta = el("textarea", "try-code");
      ta.value = task.starter || "";
      ta.spellcheck = false;
      editorArea.appendChild(ta);

      const controls = el("div", "try-controls");
      const runBtn = el("button", "run-btn", "▶ Run");
      controls.appendChild(runBtn);
      editorArea.appendChild(controls);

      const outWrap = el("div", "try-out");
      const outText = el("pre", "out-text");
      outWrap.appendChild(outText);
      editorArea.appendChild(outWrap);

      card.appendChild(editorArea);

      // We need a local stdin capture because test uses standard pyrunner which pops up `prompt()` by default.
      // For automated tests we want to feed `task.stdin` programmatically without blocking on prompt.
      // But we can patch pyrunner right before we run.
      runBtn.addEventListener("click", async () => {
        if (submitted) return;
        runBtn.textContent = "Running…";
        runBtn.disabled = true;

        outText.textContent = "";
        let inputs = [...(task.stdin || [])];
        let pyRunnerModded = false;
        if (window.PyRunner && window.PyRunner._origRun) {} // already modded

        // Temporarily patch window.prompt so input() reads from our array
        const origPrompt = window.prompt;
        window.prompt = () => {
          if (inputs.length) return inputs.shift();
          return "";
        };

        try {
          const res = await window.PyRunner.run(ta.value);
          const outStr = (res.stdout + (res.error ? "\n" + res.error : "")).trim();
          outText.textContent = outStr;

          if (task.expected) {
             const cleanExpected = String(task.expected).trim();
             const cleanActual = outStr;
             const isCorrect = cleanActual.includes(cleanExpected) || cleanActual === cleanExpected;
             codingState[ci].pass = isCorrect;
             const pct = coding.length > 0 ? Math.round((codingState.filter(x=>x.pass).length / coding.length) * 100) : 100;

             if (isCorrect) outText.innerHTML += '\n<span style="color:#4caf50;font-weight:bold">✓ Passed</span>';
             else outText.innerHTML += '\n<span style="color:#f44336;font-weight:bold">✗ Output does not match expected</span>';
          }
        } finally {
          window.prompt = origPrompt;
          runBtn.textContent = "▶ Run";
          runBtn.disabled = false;
        }
      });

      form.appendChild(card);
    });

    root.appendChild(form);

    const submit = el("button", "complete-btn", "✅ Submit test");
    const result = el("div", "test-result");

    function doSubmit(isTimeout) {
      if (submitted) return;
      submitted = true;
      clearInterval(tick);
      submit.disabled = true;

      let correct = 0;

      // check coding
      coding.forEach((task, ci) => {
         if (codingState[ci].pass) correct++;
         const ta = form.querySelectorAll(".coding-task textarea")[ci];
         if (ta) ta.disabled = true;
         const runB = form.querySelectorAll(".coding-task .run-btn")[ci];
         if (runB) runB.disabled = true;
      });

      const pct = coding.length > 0 ? Math.round((correct / coding.length) * 100) : 100;
      const pass = pct >= PASS_PCT;

      result.className = "test-result show " + (pass ? "pass" : "fail");
      result.innerHTML = (isTimeout ? "⏰ Time's up! " : "") + (pass ? "🎉 " : "📚 ") + "You scored <strong>" + correct + "/" + coding.length +
        " (" + pct + "%)</strong>. " + (pass ? "Passed — nice work!" : "Keep going — review the days above and retry.");

      if (pass && isGating && window.Py22 && window.Py22.markTestPassed) {
         window.Py22.markTestPassed(mod.id);
         window.Py22.notify(); // refresh sidebar / unlock UI
      }

      result.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    submit.addEventListener("click", () => doSubmit(false));
    root.appendChild(submit);
    root.appendChild(result);

    app.innerHTML = "";
    app.appendChild(root);
    window.scrollTo(0, 0);
  }

  // ---------- Exam-prep page ----------
  async function viewExam(app) {
    const c = await getCourse();
    const titles = await getDayTitles();
    const root = el("div", "exam-view");
    root.appendChild(el("div", "crumbs", '<a href="#/">🏠 Home</a> &nbsp;›&nbsp; ' + c.exam.code + " Exam Prep"));
    root.appendChild(el("h1", null, "🎓 " + c.exam.code + " — Exam Map"));
    root.appendChild(el("div", "exam-facts",
      '<span class="pill">📋 ' + c.exam.questions + " questions</span>" +
      '<span class="pill">✅ Pass: ' + c.exam.pass + "</span>" +
      '<span class="pill">⏱️ ' + c.exam.minutes + " min</span>"));
    root.appendChild(el("p", "lead", "The PCEP (Certified Entry-Level Python Programmer) exam has four blocks. Here's exactly which days cover each one, so you know you're ready."));

    c.examObjectives.forEach((b) => {
      const card = el("div", "exam-block");
      card.appendChild(el("div", "exam-block-head",
        '<h2>Block ' + b.block + ": " + b.name + "</h2>" +
        '<span class="exam-weight">' + b.weight + " · " + b.items + " items</span>"));
      card.appendChild(el("p", "exam-topics", b.topics));
      const links = el("div", "exam-links");
      b.days.forEach((day) => {
        const t = titles[day] || { title: "Day " + day, emoji: "📄" };
        const done = window.Py22.isDone(day);
        const a = el("a", "exam-day" + (done ? " done" : ""));
        a.href = "#/day/" + day;
        a.innerHTML = (done ? "✓ " : "") + t.emoji + " Day " + day + ": " + t.title;
        links.appendChild(a);
      });
      card.appendChild(links);
      root.appendChild(card);
    });

    const note = el("div", "tip");
    note.innerHTML = '<span class="tip-emoji">💡</span><div>This site teaches everything PCEP needs. The exam is taken at <a href="https://pythoninstitute.org/pcep" target="_blank" rel="noopener">pythoninstitute.org/pcep</a> — these lessons + the module tests are your practice.</div>';
    root.appendChild(note);

    app.innerHTML = "";
    app.appendChild(root);
    window.scrollTo(0, 0);
  }

  // ---------- wiring ----------
  function init() {
    const toggle = document.getElementById("outlineToggle");
    const backdrop = document.getElementById("backdrop");
    if (toggle) toggle.addEventListener("click", () => {
      const sb = document.getElementById("sidebar");
      setSidebarOpen(!sb.classList.contains("open"));
    });
    if (backdrop) backdrop.addEventListener("click", () => setSidebarOpen(false));
    // Escape closes the drawer when it's open
    document.addEventListener("keydown", (e) => {
      const sb = document.getElementById("sidebar");
      if (e.key === "Escape" && sb && sb.classList.contains("open")) setSidebarOpen(false);
    });
    // close drawer when a lesson link is clicked (mobile)
    document.getElementById("sidebar").addEventListener("click", (e) => {
      if (e.target.closest("a") && window.innerWidth < 900) setSidebarOpen(false);
    });
    buildSidebar();
    if (window.Py22) window.Py22.onChange(syncSidebar);
  }

  window.Course = { viewModules, viewModuleTest, viewExam, syncSidebar, init };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
