/* api/ai.js — Vercel serverless function: AI Python tutor via OpenRouter.

   POST /api/ai
   Body: { message, lessonDay?, lessonTitle?, codeContext?, history?:[{role,content}] }
   Returns: { ok, reply } or { ok:false, error }

   Uses OpenRouter's free tier (Qwen3-Coder) to power a Python tutor chatbot.
   API key is kept server-side via OPENROUTER_API_KEY env var. */

"use strict";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const PRIMARY_MODEL = "google/gemini-pro-1.5-exp";
const FALLBACK_MODEL = "meta-llama/llama-3-8b-instruct:free";
const MAX_HISTORY = 10;
const MAX_MSG_LEN = 2000;

// ---- Simple in-memory rate limiter (resets on cold start) ----
const ipCounts = {};
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 30;

function checkRateLimit(ip) {
  const now = Date.now();
  if (!ipCounts[ip] || now - ipCounts[ip].start > RATE_WINDOW_MS) {
    ipCounts[ip] = { start: now, count: 1 };
    return true;
  }
  ipCounts[ip].count++;
  return ipCounts[ip].count <= RATE_LIMIT;
}

// ---- Helpers (matching api/run.js patterns) ----
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body.length) {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return {}; }
}

// ---- Build system prompt ----
function buildSystemPrompt(lessonDay, lessonTitle, codeContext) {
  let sys = `You are a friendly, encouraging Python tutor helping a beginner learn Python through a 22-day course. Your name is PyBuddy.

Rules:
- Use simple, clear language a teenager could understand.
- Give short, focused answers (under 200 words unless they ask for more).
- Include Python code examples when helpful, wrapped in code blocks.
- Be encouraging — celebrate small wins, never make the student feel dumb.
- If they share code with a bug, explain what's wrong and guide them to fix it — don't just give the answer.
- Stay on topic: Python programming and computer science basics.
- If asked something unrelated to programming, gently redirect.
- Use emojis sparingly to keep it fun.
- When showing code, keep examples beginner-friendly and related to the current lesson topic.
- Do NOT use markdown headers (# or ##). Use plain text with bold (**text**) for emphasis.`;

  if (lessonDay && lessonTitle) {
    sys += `\n\nThe student is currently on Day ${lessonDay} of 22: "${lessonTitle}". Tailor your explanations to this topic and their current level. Days 1-7 are absolute basics, 8-14 are intermediate, 15-22 are advanced.`;
  }

  if (codeContext) {
    sys += `\n\nThe student's current code in the editor:\n\`\`\`python\n${codeContext.slice(0, 1500)}\n\`\`\`\nRefer to this code when they ask about "my code" or "this code".`;
  }

  return sys;
}

// ---- Call OpenRouter ----
async function callOpenRouter(messages, model) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY not configured. Add it in Vercel project settings.");
  }

  const resp = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": "https://python-in-22-days.vercel.app",
      "X-OpenRouter-Title": "Python in 22 Days — AI Tutor",
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 1024,
      temperature: 0.7,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`OpenRouter ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const data = await resp.json();
  const reply = data.choices?.[0]?.message?.content;
  if (!reply) throw new Error("No response from AI model");
  return reply;
}

// ---- Main handler ----
module.exports = async (req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method not allowed. Use POST." });
    return;
  }

  // Rate limit by IP
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
  if (!checkRateLimit(ip)) {
    sendJson(res, 429, { ok: false, error: "Too many requests. Please wait a minute and try again." });
    return;
  }

  let body;
  try { body = await readBody(req); }
  catch { sendJson(res, 400, { ok: false, error: "Invalid JSON body." }); return; }

  const { message, lessonDay, lessonTitle, codeContext, history } = body || {};

  if (!message || typeof message !== "string" || !message.trim()) {
    sendJson(res, 400, { ok: false, error: "Missing 'message'." });
    return;
  }

  if (message.length > MAX_MSG_LEN) {
    sendJson(res, 400, { ok: false, error: `Message too long (max ${MAX_MSG_LEN} characters).` });
    return;
  }

  // Build messages array
  const systemPrompt = buildSystemPrompt(lessonDay, lessonTitle, codeContext);
  const messages = [{ role: "system", content: systemPrompt }];

  // Add conversation history (capped)
  if (Array.isArray(history)) {
    const trimmed = history.slice(-MAX_HISTORY);
    for (const h of trimmed) {
      if (h && (h.role === "user" || h.role === "assistant") && typeof h.content === "string") {
        messages.push({ role: h.role, content: h.content.slice(0, MAX_MSG_LEN) });
      }
    }
  }

  messages.push({ role: "user", content: message.trim() });

  // Try primary model, fallback on failure
  try {
    const reply = await callOpenRouter(messages, PRIMARY_MODEL);
    sendJson(res, 200, { ok: true, reply });
  } catch (primaryErr) {
    try {
      const reply = await callOpenRouter(messages, FALLBACK_MODEL);
      sendJson(res, 200, { ok: true, reply });
    } catch (fallbackErr) {
      console.error("Primary Error:", primaryErr.message);
      console.error("Fallback Error:", fallbackErr.message);
      sendJson(res, 502, {
        ok: false,
        error: "AI tutor is temporarily unavailable. Primary Error: " + primaryErr.message + " | Fallback Error: " + fallbackErr.message
      });
    }
  }
};