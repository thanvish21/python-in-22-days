# 🐍 Python Pro

A friendly, **kid-simple** course that takes you from absolute beginner to confident Python programmer in the Pro path (about 3 hours a day). Every lesson runs **real Python right in your browser** — no installs, no setup. Just open it and start coding.

> Inspired by playful learn-to-code sites like Coddy: colorful, bite-sized, and hands-on.

## ✨ What's inside

- **the Pro path, beginner → pro** — from `print()` to classes, files, and a capstone project.
- **Run real Python in the browser** — powered by [Pyodide](https://pyodide.org). Click **Run**, see output instantly.
- **🤖 AI Python Tutor (PyBuddy)** — a built-in AI assistant that understands your current lesson and code. Ask questions, get explanations, debug your code, or request practice problems. Powered by free models via [OpenRouter](https://openrouter.ai).
- **Interactive exercises** — fill-in-the-blank "try it" boxes with auto-checking, quizzes, and a daily challenge.
- **Progress tracking & badges** — your progress is saved in the browser; days unlock as you finish, and you earn badges along the way.
- **Safe to experiment** — a built-in watchdog stops runaway/infinite loops so the page never freezes.

## 🗺️ Curriculum

| Day | Topic | Day | Topic |
|----|----|----|----|
| 1 | Meet Python | 12 | Dictionaries |
| 2 | Variables & Data Types | 13 | Functions |
| 3 | Strings & f-strings | 14 | Scope & Arguments |
| 4 | Numbers & Math | 15 | Errors & try/except |
| 5 | Input & Conversion | 16 | Files |
| 6 | Booleans & Logic | 17 | Modules & Stdlib |
| 7 | if / elif / else | 18 | Classes & Objects |
| 8 | Lists | 19 | Inheritance & Dunders |
| 9 | for Loops | 20 | Comprehensions & Lambda |
| 10 | while Loops | 21 | pip & Real Libraries |
| 11 | Tuples & Sets | 22 | Capstone & Pro Roadmap |

## 🚀 Run it locally

It's a static site — any web server works. Because lessons are loaded with `fetch()`, open it via a server (not `file://`):

```bash
# from the project folder
python3 -m http.server 8000
# then visit http://localhost:8000
```

## 🤖 AI Tutor Setup

The AI tutor (PyBuddy) uses [OpenRouter](https://openrouter.ai) for free AI model access.

1. Sign up at [openrouter.ai](https://openrouter.ai) (free)
2. Create an API key at [openrouter.ai/keys](https://openrouter.ai/keys)
3. Add `OPENROUTER_API_KEY` to your Vercel project environment variables
4. Deploy — the tutor will use `nvidia/nemotron-3-ultra-550b-a55b:free` (with Qwen3 Coder fallback), both 100% free

The tutor automatically knows which lesson the student is on and can see their code editor contents.

## ☁️ Deploy

**Vercel** (recommended): import the GitHub repo at [vercel.com/new](https://vercel.com/new). No build step — it's static. `vercel.json` is already included.

**GitHub Pages**: Settings → Pages → deploy from the `main` branch root.

## 🧱 How it's built

Plain HTML/CSS/JavaScript — no framework, no build step.

```
index.html          # app shell
css/styles.css      # playful theme
js/pyrunner.js      # loads Pyodide, runs code with a 12s safety watchdog
js/render.js        # turns a lesson JSON into interactive DOM
js/app.js           # router, progress, unlock, badges
js/ai-tutor.js      # PyBuddy AI tutor chat panel
data/manifest.json  # the day list
data/dayNN.json     # one file per lesson
verify.py           # checks every lesson: JSON schema + compiles/runs all snippets
```

### Lesson format

Each `data/dayNN.json` is a lesson with `blocks` (`text`, `code`, `tryit`, `quiz`, `tip`) and a `challenge`. To verify all lessons still parse and every code snippet runs:

```bash
python3 verify.py
```

## 🤝 Contributing a lesson

Copy an existing `data/dayNN.json`, keep the same shape, and run `python3 verify.py` until it prints ✅. Code in `code`/`solution` blocks must run on the standard library only (that's all the browser has).

---

Made with 💚 for curious minds. Happy coding!
