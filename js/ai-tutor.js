/* ===== ai-tutor.js — PyBuddy: AI Python tutor chat panel ===== */
(function () {
  "use strict";

  var API_URL = "/api/ai";
  var MAX_MSG = 2000;

  // ---- State ----
  var isOpen = false;
  var history = []; // [{role, content}]
  var sending = false;

  // ---- DOM helpers ----
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Format AI reply: convert markdown code blocks and bold to HTML
  function formatReply(text) {
    // Remove <think>...</think> blocks (some models include reasoning)
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    // Code blocks
    text = text.replace(/```(\w*)\n([\s\S]*?)```/g, function (_, lang, code) {
      return '<pre class="ai-code">' + escapeHtml(code.trim()) + "</pre>";
    });
    // Inline code
    text = text.replace(/`([^`]+)`/g, '<code class="ai-inline">$1</code>');
    // Bold
    text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    // Newlines
    text = text.replace(/\n/g, "<br>");
    return text;
  }

  // ---- Get lesson context from current route ----
  function getLessonContext() {
    var hash = location.hash || "";
    var m = hash.match(/^#\/day\/(\d+)/);
    if (!m) return { day: null, title: null };
    var day = Number(m[1]);
    var h1 = document.querySelector(".lesson-head h1");
    var title = null;
    if (h1) {
      title = h1.textContent.replace(/^Day\s+\d+:\s*/, "").trim();
    }
    return { day: day, title: title };
  }

  // ---- Get code from the nearest editor ----
  function getCodeContext() {
    var editors = document.querySelectorAll("textarea.code-area");
    if (!editors.length) return null;
    var code = null;
    editors.forEach(function (ed) {
      if (ed.value.trim()) code = ed.value;
    });
    return code;
  }

  // ---- Build the chat UI ----
  function buildUI() {
    // Floating button
    var fab = el("button", "ai-fab");
    fab.id = "aiFab";
    fab.title = "Ask PyBuddy — AI Python Tutor";
    fab.setAttribute("aria-label", "Open AI tutor chat");
    fab.innerHTML = '<span class="ai-fab-icon">🤖</span><span class="ai-fab-pulse"></span>';

    // Chat panel
    var panel = el("div", "ai-panel");
    panel.id = "aiPanel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "AI Python Tutor");

    panel.innerHTML =
      '<div class="ai-header">' +
        '<div class="ai-header-left">' +
          '<span class="ai-avatar">🤖</span>' +
          '<div>' +
            '<div class="ai-name">PyBuddy</div>' +
            '<div class="ai-subtitle">AI Python Tutor · Free</div>' +
          '</div>' +
        '</div>' +
        '<button class="ai-close" aria-label="Close chat" title="Close">&times;</button>' +
      '</div>' +
      '<div class="ai-messages" id="aiMessages">' +
        '<div class="ai-welcome">' +
          '<div class="ai-welcome-emoji">🐍</div>' +
          '<div class="ai-welcome-title">Hey! I\'m PyBuddy</div>' +
          '<div class="ai-welcome-sub">Your AI Python tutor. Ask me anything about the lesson, your code, or Python in general!</div>' +
          '<div class="ai-quick-prompts" id="aiQuickPrompts">' +
            '<button class="ai-quick" data-msg="Explain the concept from this lesson in simple terms">💡 Explain this</button>' +
            '<button class="ai-quick" data-msg="Can you help me understand my code and fix any issues?">🔧 Help with my code</button>' +
            '<button class="ai-quick" data-msg="Give me a fun practice problem related to this lesson">🎯 Practice problem</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="ai-input-wrap">' +
        '<textarea class="ai-input" id="aiInput" placeholder="Ask me anything about Python..." rows="1" maxlength="' + MAX_MSG + '"></textarea>' +
        '<button class="ai-send" id="aiSend" title="Send" aria-label="Send message">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>' +
        '</button>' +
      '</div>';

    document.body.appendChild(fab);
    document.body.appendChild(panel);

    // Wire events
    fab.addEventListener("click", togglePanel);
    panel.querySelector(".ai-close").addEventListener("click", togglePanel);

    var input = document.getElementById("aiInput");
    var sendBtn = document.getElementById("aiSend");

    sendBtn.addEventListener("click", function () { sendMessage(); });

    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Auto-resize input
    input.addEventListener("input", function () {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 120) + "px";
    });

    // Quick prompts
    document.getElementById("aiQuickPrompts").addEventListener("click", function (e) {
      var btn = e.target.closest(".ai-quick");
      if (!btn) return;
      var msg = btn.getAttribute("data-msg");
      if (msg) {
        input.value = msg;
        sendMessage();
      }
    });
  }

  function togglePanel() {
    isOpen = !isOpen;
    var panel = document.getElementById("aiPanel");
    var fab = document.getElementById("aiFab");
    panel.classList.toggle("open", isOpen);
    fab.classList.toggle("hidden", isOpen);
    if (isOpen) {
      setTimeout(function () { document.getElementById("aiInput").focus(); }, 200);
    }
  }

  // ---- Send a message ----
  function sendMessage() {
    if (sending) return;
    var input = document.getElementById("aiInput");
    var msg = input.value.trim();
    if (!msg) return;

    input.value = "";
    input.style.height = "auto";

    // Hide welcome on first message
    var welcome = document.querySelector(".ai-welcome");
    if (welcome) welcome.style.display = "none";

    // Add user bubble
    addBubble("user", msg);
    history.push({ role: "user", content: msg });

    // Show thinking indicator
    var thinking = addThinking();
    sending = true;
    updateSendBtn();

    var ctx = getLessonContext();
    var codeCtx = getCodeContext();

    fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: msg,
        lessonDay: ctx.day,
        lessonTitle: ctx.title,
        codeContext: codeCtx,
        history: history.slice(0, -1),
      }),
    })
    .then(function (resp) { return resp.json(); })
    .then(function (data) {
      thinking.remove();
      if (data.ok && data.reply) {
        addBubble("ai", data.reply);
        history.push({ role: "assistant", content: data.reply });
      } else {
        addBubble("error", data.error || "Something went wrong. Please try again.");
      }
    })
    .catch(function () {
      thinking.remove();
      addBubble("error", "Couldn't reach the AI tutor. Check your connection and try again.");
    })
    .finally(function () {
      sending = false;
      updateSendBtn();
    });
  }

  function addBubble(type, text) {
    var msgs = document.getElementById("aiMessages");
    var bubble = el("div", "ai-bubble ai-" + type);

    if (type === "ai") {
      bubble.innerHTML = '<span class="ai-bubble-avatar">🤖</span><div class="ai-bubble-content">' + formatReply(text) + "</div>";
    } else if (type === "user") {
      bubble.innerHTML = '<div class="ai-bubble-content">' + escapeHtml(text) + "</div>";
    } else {
      bubble.innerHTML = '<span class="ai-bubble-avatar">⚠️</span><div class="ai-bubble-content ai-error-text">' + escapeHtml(text) + "</div>";
    }

    msgs.appendChild(bubble);
    msgs.scrollTop = msgs.scrollHeight;
    return bubble;
  }

  function addThinking() {
    var msgs = document.getElementById("aiMessages");
    var dot = el("div", "ai-bubble ai-ai ai-thinking");
    dot.innerHTML = '<span class="ai-bubble-avatar">🤖</span><div class="ai-bubble-content"><span class="ai-dots"><span>.</span><span>.</span><span>.</span></span> Thinking</div>';
    msgs.appendChild(dot);
    msgs.scrollTop = msgs.scrollHeight;
    return dot;
  }

  function updateSendBtn() {
    var btn = document.getElementById("aiSend");
    btn.disabled = sending;
  }

  // ---- Init ----
  buildUI();
})();
