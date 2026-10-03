# Lifeline — the internship operating system

A **completely free**, open, local-first alternative to paywalled internship tools.
Lifeline finds internship openings, scores them against your profile, tailors your
resume for each one, runs an autopilot application pipeline, tracks interviews &
deadlines, and builds referral outreach kits.

**No paywall. No account. No paid APIs. No download needed** — it runs straight
from GitHub Pages in your browser.

## Use it right now

👉 **Open the GitHub Pages link for this repo** — the full app loads in your browser
and your data is stored in your browser's localStorage. Nothing to install.

> Browser mode = the whole engine (scoring, tailoring, autopilot, referral drafts,
> live radar scans) runs in JavaScript on your machine. Use **Settings → Export**
> to back up your data as JSON.

## Features

| Module | What it does |
| --- | --- |
| **Mission Control** | Readiness score, next-best-move coaching, autopilot activity feed |
| **Radar** | Curated Lifeline Index + live scans of public feeds (Remotive, Arbeitnow), every role scored against your skills, deadline warnings |
| **Resume Vault** | Your master profile; every tailored resume is rebuilt from it — nothing invented |
| **Autopilot** | One pass builds a tailored resume + cover letter per shortlisted role and dispatches applications; 14-day deadlines auto-pin to the Tracker |
| **Referral Engine** | LinkedIn X-ray & alumni search links, email-pattern guesses, connection note + cold email + follow-up drafts, outreach log |
| **Interview Prep** | 30-question bank (technical / behavioral / firm / quant), session logging, readiness scoring |
| **Tracker** | Deadlines, interviews, follow-ups on one timeline |

## Cost: $0

- The built-in tailoring/scoring engine is the default — **works offline, no key, no signup**.
- Optional AI rewrites use **free tiers only** (one-click presets in Settings):
  - **Groq** — free tier, no card (console.groq.com)
  - **OpenRouter** — free `:free` models (openrouter.ai)
  - **Ollama** — run models on your own machine, no key at all
- Live radar scans hit free public job feeds (via the free AllOrigins proxy in browser mode).

## Two ways to run

### 1. GitHub Pages (zero setup)
Already enabled for this repo — just open the Pages URL in a browser.

### 2. Local server mode (optional, for development)
```bash
pip install -r requirements.txt
python3 -m uvicorn app.server:app --host 0.0.0.0 --port 8000
```
Adds SQLite persistence in `data/lifeline.db` on top of the same UI.

## Notes

- Referral outreach is **draft-only by design**: Lifeline never auto-messages people.
  You personalize, you approve, you send — that's what actually gets replies.
- "Auto-submit" dispatches through each role's application link and logs the action;
  keep the toggle in Settings matched to how much you trust the queue.
