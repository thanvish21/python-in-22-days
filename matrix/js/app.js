/* ===== app.js — 1% HFT Matrix router, per-problem mastery, theme ===== */
(function () {
  "use strict";

  const STORE_KEY = "hft_matrix_mastery_v1";
  const app = document.getElementById("app");

  // ---- mastery state (localStorage) ----
  // A problem is "mastered" when all of its tests pass (Grade succeeds).
  // Shape: { mastered: { "py-t1-p1": true, ... } }
  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        const mastered = (p && typeof p.mastered === "object" && p.mastered) ? p.mastered : {};
        return { mastered };
      }
    } catch (e) { /* ignore */ }
    return { mastered: {} };
  }
  function saveProgress(p) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(p)); }
    catch (e) { /* private mode / quota: progress just won't persist */ }
  }
  let progress = loadProgress();

  const isMastered = (id) => !!progress.mastered[id];
  const masteredCount = () => Object.keys(progress.mastered).filter((k) => progress.mastered[k]).length;

  function markMastered(id) {
    if (!id || progress.mastered[id]) return;
    progress.mastered[id] = true;
    saveProgress(progress);
    updateStreak();
  }

  function updateStreak() {
    const el = document.getElementById("streakCount");
    if (el) el.textContent = masteredCount();
  }

  // ---- data loaders ----
  let tierIndex = null;
  async function getTiers() {
    if (tierIndex) return tierIndex;
    const res = await fetch("data/tiers.json");
    if (!res.ok) throw new Error("tiers.json not found");
    tierIndex = await res.json();
    return tierIndex;
  }

  async function getTier(n) {
    const res = await fetch("data/tier" + String(n) + ".json");
    if (!res.ok) {
      const err = new Error("Tier not found");
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  // ---- views ----
  async function viewMatrix() {
    app.innerHTML = '<div class="center-msg">Loading the Matrix… ⚡</div>';
    let data;
    try { data = await getTiers(); }
    catch (e) {
      app.innerHTML = '<div class="center-msg">Could not load the tier index. Run this on a static server (see README).</div>';
      return;
    }

    const tiers = data.tiers || [];
    const total = tiers.length;
    const mastered = masteredCount();

    const hero = document.createElement("div");
    hero.className = "view-enter";
    hero.innerHTML =
      '<section class="hero matrix-hero">' +
        '<div class="matrix-kicker">// PYTHON SYSTEMS ENGINEERING</div>' +
        "<h1>The <span class=\"accent\">1% HFT</span> Matrix</h1>" +
        "<p>Four tiers of real, interview-grade Python: async networking under backpressure, " +
        "high-performance memory, advanced metaprogramming, and GIL escape. Code runs and grades " +
        "right here — Pyodide in-browser, native on the backend.</p>" +
        '<div class="matrix-stat"><span class="mono">' + mastered + "</span> problems mastered" +
          (total ? ' · <span class="mono">' + total + "</span> tiers" : "") + "</div>" +
      "</section>";

    const grid = document.createElement("div");
    grid.className = "matrix-grid";
    tiers.forEach((t, i) => {
      const card = document.createElement("a");
      card.className = "tier-card card-enter";
      card.style.setProperty("--i", Math.min(i, 12));
      card.href = "#/tier/" + t.tier;
      card.innerHTML =
        '<div class="tier-card-top">' +
          '<span class="tier-emoji">' + (t.emoji || "⚡") + "</span>" +
          '<span class="tier-no">T' + t.tier + "</span>" +
        "</div>" +
        '<div class="tier-card-title">' + escapeInline(t.title || ("Tier " + t.tier)) + "</div>" +
        '<div class="tier-card-tag">' + (t.tag ? "#" + escapeInline(t.tag) : "") + "</div>" +
        '<div class="tier-card-summary">' + escapeInline(t.summary || "") + "</div>";
      grid.appendChild(card);
    });

    app.innerHTML = "";
    app.appendChild(hero);
    const h = document.createElement("h2");
    h.className = "section-title";
    h.textContent = "▚ Select your tier";
    app.appendChild(h);
    app.appendChild(grid);
    window.scrollTo(0, 0);
  }

  async function viewTier(n) {
    n = Number(n);
    if (!n || n < 1) return viewMatrix();

    app.innerHTML = '<div class="center-msg">Opening Tier ' + n + "… ⚡</div>";
    let data;
    try { data = await getTier(n); }
    catch (e) {
      if (e && e.status === 404) {
        app.innerHTML = '<div class="center-msg">📝 Tier ' + n + " is being written — check back soon." +
          '<br><br><a class="hero-cta" href="#/">⌂ Back to the Matrix</a></div>';
      } else {
        app.innerHTML = '<div class="center-msg">😕 Couldn\'t load this tier — if you opened the file directly, run it on a server (see README).' +
          '<br><br><a class="hero-cta" href="#/">⌂ Back to the Matrix</a></div>';
      }
      window.scrollTo(0, 0);
      return;
    }

    const view = window.Render.renderTier(data, {
      isMastered,
      onMastered: markMastered,
    });

    // Warm up Pyodide in the background so the first Run/Grade feels instant.
    // Swallow any rejection (offline/CDN slow) — the real error surfaces on Run.
    if (window.PyRunner) {
      try {
        const warm = window.PyRunner.getPyodide();
        if (warm && typeof warm.catch === "function") warm.catch(() => {});
      } catch (e) { /* ignore */ }
    }

    app.innerHTML = "";
    app.appendChild(view);
    window.scrollTo(0, 0);
  }

  function escapeInline(s) { return String(s == null ? "" : s).replace(/[<>]/g, (c) => ({ "<": "&lt;", ">": "&gt;" }[c])); }

  // ---- expose mastery API for render.js (Grade hooks call onMastered) ----
  window.HFTMatrix = {
    isMastered,
    masteredCount,
    markMastered,
  };

  // ---- router ----
  function route() {
    const hash = location.hash || "#/";
    let m;
    if ((m = hash.match(/^#\/tier\/(\d+)/))) viewTier(m[1]);
    else viewMatrix();
  }

  // ---- reset ----
  const resetBtn = document.getElementById("resetBtn");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      if (confirm("Reset all mastery progress? This can't be undone.")) {
        progress = { mastered: {} };
        saveProgress(progress);
        updateStreak();
        location.hash = "#/";
        route();
      }
    });
  }

  // ---- theme toggle ----
  const THEME_KEY = "hft_matrix_theme";
  const themeBtn = document.getElementById("themeToggle");
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    if (themeBtn) themeBtn.textContent = theme === "dark" ? "☀️" : "🌙";
  }
  function loadTheme() {
    try { return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light"; }
    catch (e) { return "light"; }
  }
  applyTheme(loadTheme());
  if (themeBtn) {
    themeBtn.addEventListener("click", () => {
      const next = loadTheme() === "dark" ? "light" : "dark";
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* private mode / quota */ }
    });
  }

  window.addEventListener("hashchange", route);
  updateStreak();
  route();
})();
