# E2E Test Suite — Student Journey

Single-student end-to-end tests that validate the full lifecycle from sign-in through exam completion, review, and progress tracking.

## Setup

```bash
# 1. Copy and fill in credentials
cp .env.example .env.test

# Required env vars:
#   TEST_USER_EMAIL      — Clerk test user email
#   TEST_USER_PASSWORD   — Clerk test user password
#   BASE_URL             — Frontend (default: http://localhost:3000)
#   API_URL              — Backend  (default: http://localhost:8000)

# 2. Install Playwright browsers (first time only)
npx playwright install chromium

# 3. Start services before running
cd backend && uvicorn src.main:app --reload   # Terminal 1
cd frontend && npm run dev                     # Terminal 2
```

## Run

```bash
# Headless (CI)
npm run test:e2e

# Headed (watch the browser)
npm run test:e2e:headed

# Single test case
npx playwright test --project=e2e -g "TC-07"

# Show HTML report after run
npx playwright show-report
```

## Test Cases

| ID    | Area                        | What it validates |
|-------|-----------------------------|-------------------|
| TC-01 | Backend health              | `/health` returns 200 |
| TC-02 | Authentication              | Clerk sign-in lands on dashboard |
| TC-03 | Dashboard — pre-diagnostic  | Both diagnostic CTAs visible, progress empty state |
| TC-04 | Math Diagnostic             | Full adaptive exam completes without error |
| TC-05 | RW Diagnostic               | Full adaptive exam completes without error |
| TC-06 | Post-diagnostic dashboard   | "Completed" badge reflects finished diagnostics |
| TC-07 | Progress Panel              | Domain accuracy chart renders after diagnostic |
| TC-08 | Study recommendations       | "What to study today" appears (student_profile created) |
| TC-09 | Daily practice — Math       | Session starts, exam runner loads, timer visible |
| TC-10 | Question UX                 | Stem, options (≥2), calculator, question counter all visible |
| TC-11 | Math rendering              | KaTeX/MathML renders; no raw `\frac` visible in text |
| TC-12 | IndexedDB persistence       | Answers survive page reload, session resumes |
| TC-13 | Adaptive module routing     | Module 1 submit triggers module 2 (no crash) |
| TC-14 | Session history & review    | Completed session in Cockpit, Review button navigates |
| TC-15 | Review page UX              | Correct/incorrect icons, explanation, retry button |
| TC-16 | Tutor interaction           | Tutor chat input visible, response arrives |
| TC-17 | Full-length simulation      | Start Full Mock Exam navigates to /simulation |
| TC-18 | Score range sanity          | All scores 200–800 (catches score=200 bug) |
| TC-19 | Score disclosure            | "Estimated" disclaimer visible near any score |
| TC-20 | Offline resilience          | Exam survives network cut; recovers on restore |
| TC-21 | Exit exam navigation        | Student can leave mid-session, returns to dashboard |
| TC-22 | Sessions API structure      | `/api/student/sessions` well-formed response |
| TC-23 | Recommendations API         | `/api/student/recommendations` valid structure |
| TC-24 | Curriculum graph API        | `/api/curriculum/graph` returns nodes + links |
| TC-25 | Sign out                    | Clerk sign-out redirects to home page |

## Known Issues Being Uncovered

These tests are instrumented to **warn without failing** for UX issues:

- **TC-07**: Progress panel stays empty after diagnostic → curriculum graph not finding user's response_history
- **TC-10**: Calculator button missing → toolbar not rendering for some exam types
- **TC-11**: Raw LaTeX visible → MathRenderer not processing all expression formats
- **TC-13**: Module routing → adaptive routing returning wrong module or crashing
- **TC-15**: No explanation visible → `ai_explanation` / `solution_text` not passed to review
- **TC-16**: No tutor response → tutor API timeout or auth failure
- **TC-18**: Score outside 200–800 → catches the score=200 anomaly bug
- **TC-20**: App crashes on network loss → offline-first IndexedDB not saving answers

## Architecture Notes

- Tests run **sequentially** (workers=1) so state carries across TCs (session from TC-04 used in TC-14)
- `answerAllQuestionsOnPage()` helper selects the first available option — not trying to answer correctly, just exercising the flow
- Failures are surfaced as `console.warn('[TC-XX] ISSUE: ...')` so the report identifies root causes
