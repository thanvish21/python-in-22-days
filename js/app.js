/* ===== app.js — router, progress, day-unlock, badges ===== */
(function () {
  "use strict";

  const TOTAL_DAYS = 22;
  const STORE_KEY = "py22_progress_v1";
  const app = document.getElementById("app");

  // ---- progress state (localStorage) ----
  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        const completed = (p && typeof p.completed === "object" && p.completed) ? p.completed : {};
        const lastDay = (p && Number.isFinite(p.lastDay)) ? p.lastDay : 1;
        return { completed, lastDay };
      }
    } catch (e) { /* ignore */ }
    return { completed: {}, lastDay: 1 };
  }
  function saveProgress(p) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(p)); }
    catch (e) { /* private mode / quota: progress just won't persist */ }
  }
  let progress = loadProgress();
  let autoAdvanceTimer = null;

  const isDone = (d) => !!progress.completed[d];
  const completedCount = () => Object.keys(progress.completed).filter((k) => progress.completed[k]).length;
  // Day 1 is always open; day N opens once day N-1 is done.
  const isUnlocked = (d) => d === 1 || isDone(d - 1);

  function markDone(d) {
    progress.completed[d] = true;
    progress.lastDay = Math.min(d + 1, TOTAL_DAYS);
    saveProgress(progress);
    updateStreak();
  }

  function updateStreak() {
    document.getElementById("streakCount").textContent = completedCount();
  }

  // ---- manifest (day list) ----
  let manifest = null;
  async function getManifest() {
    if (manifest) return manifest;
    const res = await fetch("data/manifest.json");
    manifest = await res.json();
    return manifest;
  }

  async function getLesson(day) {
    const res = await fetch("data/day" + String(day).padStart(2, "0") + ".json");
    if (!res.ok) {
      const err = new Error("Lesson not found");
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  // ---- views ----
  async function viewHome() {
    app.innerHTML = '<div class="center-msg">Loading your journey… 🐍</div>';
    let days;
    try { days = await getManifest(); }
    catch (e) { app.innerHTML = '<div class="center-msg">Could not load lessons. Run this on a server (see README).</div>'; return; }

    const done = completedCount();
    const pct = Math.round((done / TOTAL_DAYS) * 100);

    const hero = document.createElement("div");
    hero.innerHTML =
      '<section class="hero">' +
        "<h1>Learn <span class=\"accent\">Python</span> in 22 Days 🐍</h1>" +
        "<p>Friendly bite-sized lessons with real code you run right here. Simple enough for a curious kid, deep enough to take you from zero to pro.</p>" +
        '<button class="hero-cta" id="startBtn">' + (done > 0 ? "▶ Continue Day " + (Number(progress.lastDay) || 1) : "🚀 Start Day 1") + "</button>" +
        '<div class="progress-wrap">' +
          '<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
          '<div class="progress-label">' + done + " of 22 days done · " + pct + "% to pro</div>" +
        "</div>" +
      "</section>";

    const grid = document.createElement("div");
    grid.className = "grid";
    days.forEach((d) => {
      const unlocked = isUnlocked(d.day);
      const card = document.createElement(unlocked ? "a" : "div");
      card.className = "day-card" + (isDone(d.day) ? " done" : "") + (unlocked ? "" : " locked");
      if (unlocked) card.href = "#/day/" + d.day;
      card.innerHTML =
        '<div class="day-emoji">' + (d.emoji || "🐍") + "</div>" +
        '<div class="day-num">Day ' + d.day + "</div>" +
        '<div class="day-title">' + d.title + "</div>" +
        '<div class="day-meta">' + (d.tag ? "#" + d.tag : "") + "</div>";
      grid.appendChild(card);
    });

    app.innerHTML = "";
    app.appendChild(hero);
    const h = document.createElement("h2");
    h.className = "section-title";
    h.textContent = "🗺️ Your 22-Day Map";
    app.appendChild(h);
    app.appendChild(grid);

    document.getElementById("startBtn").addEventListener("click", () => {
      location.hash = "#/day/" + (done > 0 ? progress.lastDay : 1);
    });
  }

  async function viewDay(day) {
    day = Number(day);
    if (!day || day < 1 || day > TOTAL_DAYS) return viewHome();
    if (!isUnlocked(day)) {
      app.innerHTML = '<div class="center-msg">🔒 Finish Day ' + (day - 1) +
        ' first to unlock this one!<br><br><a class="hero-cta" href="#/day/' + (day - 1) + '">Go to Day ' + (day - 1) + "</a></div>";
      window.scrollTo(0, 0);
      return;
    }

    app.innerHTML = '<div class="center-msg">Opening Day ' + day + "… 🐍</div>";
    let data;
    try { data = await getLesson(day); }
    catch (e) {
      if (e && e.status === 404) {
        app.innerHTML = '<div class="center-msg">📝 Day ' + day + " is being written! Check back soon." +
          '<br><br><a class="hero-cta" href="#/">🏠 Back home</a></div>';
      } else {
        app.innerHTML = '<div class="center-msg">😕 Couldn\'t load this lesson — if you opened the file directly, run it on a server (see README).' +
          '<br><br><a class="hero-cta" href="#/">🏠 Back home</a></div>';
      }
      return;
    }

    const view = window.Render.renderLesson(data);

    // Warm up Pyodide in the background so the first Run feels instant.
    if (window.PyRunner) { try { window.PyRunner.getPyodide(); } catch (e) { /* ignore */ } }

    // lesson footer: prev / complete / next
    const nav = document.createElement("div");
    nav.className = "lesson-nav";
    const prevBtn = document.createElement("button");
    prevBtn.className = "navbtn";
    prevBtn.textContent = "← Prev";
    prevBtn.disabled = day === 1;
    prevBtn.addEventListener("click", () => { location.hash = "#/day/" + (day - 1); });

    const completeBtn = document.createElement("button");
    completeBtn.className = "complete-btn" + (isDone(day) ? " done" : "");
    completeBtn.textContent = isDone(day) ? "✓ Day " + day + " complete!" : "✅ Mark Day " + day + " complete";
    completeBtn.addEventListener("click", () => {
      const wasDone = isDone(day);
      markDone(day);
      completeBtn.classList.add("done");
      completeBtn.textContent = "✓ Day " + day + " complete!";
      if (!wasDone) {
        celebrate(day);
        if (day < TOTAL_DAYS) {
          autoAdvanceTimer = setTimeout(() => { location.hash = "#/day/" + (day + 1); }, 1400);
        }
      }
    });

    const nextBtn = document.createElement("button");
    nextBtn.className = "navbtn";
    nextBtn.textContent = "Next →";
    nextBtn.addEventListener("click", () => {
      if (!isDone(day)) { celebrate(day); markDone(day); completeBtn.classList.add("done"); completeBtn.textContent = "✓ Day " + day + " complete!"; }
      location.hash = "#/day/" + Math.min(day + 1, TOTAL_DAYS);
    });

    nav.appendChild(prevBtn);
    nav.appendChild(completeBtn);
    if (day < TOTAL_DAYS) nav.appendChild(nextBtn);
    view.appendChild(nav);

    app.innerHTML = "";
    app.appendChild(view);
    window.scrollTo(0, 0);
  }

  // ---- badge / celebration toast ----
  const BADGES = {
    1: ["🐣", "First Steps!", "You wrote your first Python!"],
    7: ["🔥", "One Week Strong!", "A full week of Python down."],
    14: ["⚡", "Two Weeks!", "You're officially dangerous now."],
    21: ["🧠", "Almost a Pro!", "21 days. One to go!"],
    22: ["🏆", "PYTHON PRO!", "You finished all 22 days. Incredible!"],
  };
  function celebrate(day) {
    const badge = BADGES[day] || ["🎉", "Day " + day + " done!", "On to the next one!"];
    showToast(badge[0], badge[1], badge[2]);
  }
  let toastTimer = null;
  function showToast(emoji, title, sub) {
    let t = document.getElementById("toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "toast";
      t.className = "toast";
      document.body.appendChild(t);
    }
    t.innerHTML = '<span class="toast-emoji">' + emoji + "</span><div><div class=\"toast-title\">" +
      title + '</div><div class="toast-sub">' + sub + "</div></div>";
    requestAnimationFrame(() => t.classList.add("show"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
  }

  // ---- expose state for the course/sidebar module ----
  const listeners = [];
  window.Py22 = {
    TOTAL_DAYS,
    isDone, isUnlocked, completedCount,
    lastDay: () => progress.lastDay,
    getManifest, getLesson,
    onChange: (fn) => listeners.push(fn),
    notify: () => listeners.forEach((fn) => { try { fn(); } catch (e) {} }),
  };
  const origMarkDone = markDone;
  markDone = function (d) { origMarkDone(d); window.Py22.notify(); };

  // ---- router ----
  function route() {
    if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
    const hash = location.hash || "#/";
    let m;
    if ((m = hash.match(/^#\/day\/(\d+)/))) viewDay(m[1]);
    else if ((m = hash.match(/^#\/test\/(\d+)/)) && window.Course) window.Course.viewModuleTest(app, Number(m[1]));
    else if (hash.startsWith("#/modules") && window.Course) window.Course.viewModules(app);
    else if (hash.startsWith("#/exam") && window.Course) window.Course.viewExam(app);
    else viewHome();
    if (window.Course) window.Course.syncSidebar();
  }

  // ---- reset ----
  document.getElementById("resetBtn").addEventListener("click", () => {
    if (confirm("Reset all your progress and badges? This can't be undone.")) {
      progress = { completed: {}, lastDay: 1 };
      saveProgress(progress);
      updateStreak();
      location.hash = "#/";
      route();
    }
  });

  window.addEventListener("hashchange", route);
  updateStreak();
  route();
})();
