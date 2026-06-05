# Senior iOS Interview Prep

A static, offline study reference with **300 Senior iOS interview questions & answers**, organized for self-testing and deep understanding — not flashcard memorization.

🔗 **Live site:** https://tinyprocessing.github.io/ios-interview-prep/

## What's inside

Each question has four parts:

- **Model answer** — a natural spoken answer (3–5 sentences) you can say out loud in an interview.
- **Deep dive** — how/why it works under the hood, subtleties, common misconceptions.
- **Follow-up trap** — a Senior-level gotcha question + its short correct answer.

### Categories (300 total)

| Category | Count |
|---|---|
| Memory Management & ARC | 35 |
| Swift Language Internals | 40 |
| Concurrency | 40 |
| UIKit | 30 |
| SwiftUI | 30 |
| Architecture & Design Patterns | 35 |
| System Design (iOS) | 30 |
| Networking & Persistence | 25 |
| Coding / Algorithms (explain-aloud) | 20 |
| Testing, Tooling & Behavioral | 15 |

## Features

- Live search across questions and answers
- Cards collapsed by default (self-test mode) — click to reveal the answer
- "Learned" checkboxes with progress tracking per category (saved in `localStorage`)
- "Unlearned only" filter, expand/collapse all
- Dark / light theme toggle
- Fully offline, no backend, no dependencies, no tracking

## Run locally

Just open `index.html` in a browser — no build step.

## Tech

Plain HTML / CSS / vanilla JS. Content lives in `data.js`; `parts/` holds the per-category source fragments.
