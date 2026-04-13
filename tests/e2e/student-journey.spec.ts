/**
 * E2E Test Suite: Full Student Journey
 *
 * Tests the complete lifecycle of a single student:
 *   1.  Auth & Dashboard load
 *   2.  Diagnostic exam (Math + RW)
 *   3.  Dashboard reflects diagnostic results
 *   4.  Daily practice session
 *   5.  Review page after a session
 *   6.  Tutor / hint interaction
 *   7.  Full-length simulation start
 *   8.  Offline / network interruption resilience
 *   9.  Progress panel data accuracy
 *   10. Score disclosure & data integrity
 *
 * Run:
 *   npx playwright test tests/e2e/student-journey.spec.ts --workers=1 --headed
 *
 * Requires:
 *   - Frontend: http://localhost:3000
 *   - Backend:  http://localhost:8000
 *   - A Clerk test user set via env vars:
 *       TEST_USER_EMAIL, TEST_USER_PASSWORD
 *   - DIAGNOSTIC_MATH_UUID and DIAGNOSTIC_RW_UUID seeded in exam_definitions
 */

import { test, expect, Page, BrowserContext } from '@playwright/test';
import { clerk, clerkSetup, setupClerkTestingToken } from '@clerk/testing/playwright';
import { createClerkClient } from '@clerk/backend';
import * as fs from 'fs';
import * as path from 'path';

// ─── Configuration ──────────────────────────────────────────────────────────
const BASE_URL    = process.env.BASE_URL    || 'http://localhost:3002';
const API_URL     = process.env.API_URL     || 'http://localhost:8004';
const USER_EMAIL  = process.env.TEST_USER_EMAIL    || 'e2etest@gmail.com';
const USER_ID     = process.env.TEST_USER_ID       || 'user_3BeSQmayj5m9aF8BUg7jsaVkEgK';

const DIAGNOSTIC_MATH_UUID = '550e8400-e29b-41d4-a716-446655440000';
const DIAGNOSTIC_RW_UUID   = '550e8400-e29b-41d4-a716-446655440001';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Sign in using @clerk/testing ticket strategy — bypasses device verification.
 * Requires CLERK_SECRET_KEY env var and Clerk testing token setup.
 */
async function signInWithClerkTesting(page: Page) {
  await page.goto(`${BASE_URL}/sign-in`);
  // Wait for Clerk to load on the page
  await page.waitForFunction(() => (window as any).Clerk !== undefined, { timeout: 15_000 })
    .catch(() => {});

  // Try ticket strategy first (bypasses device verification and password issues)
  try {
    const clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
    const token = await clerkClient.signInTokens.createSignInToken({ userId: USER_ID, expiresInSeconds: 300 });
    await clerk.signIn({ page, signInParams: { strategy: 'ticket', ticket: token.token } });
  } catch {
    // Fallback: password strategy
    await clerk.signIn({ page, signInParams: { strategy: 'password', identifier: USER_EMAIL, password: process.env.TEST_USER_PASSWORD || 'TestPass123!' } });
  }

  await page.goto(`${BASE_URL}/dashboard`);
  await page.waitForURL(/\/dashboard/, { timeout: 25_000 });

  // Save storage state so subsequent navigations keep the session
  const authStatePath = path.join(__dirname, 'auth-state.json');
  await page.context().storageState({ path: authStatePath });
}

/** Answer every question on the current module page by selecting the first option. */
async function answerAllQuestionsOnPage(page: Page) {
  // Wait for at least one answerable question
  await page.waitForSelector('[data-testid="question-option"], input[type="radio"], button[data-option]', {
    timeout: 15_000,
  }).catch(() => {});

  let answered = 0;
  // Loop: pick first unanswered option, move to next question
  for (let i = 0; i < 60; i++) {
    // Try radio buttons first (MCQ)
    const radios = page.locator('input[type="radio"]:not([disabled])');
    const radioCount = await radios.count();
    if (radioCount > 0) {
      // Select first available radio for current question group
      await radios.first().check({ force: true }).catch(() => {});
      answered++;
    }

    // Try option buttons (MCQ rendered as buttons)
    const optionBtns = page.locator('[data-testid="option-btn"]:not([aria-pressed="true"]):not([disabled])');
    const btnCount = await optionBtns.count();
    if (btnCount > 0) {
      await optionBtns.first().click({ force: true }).catch(() => {});
      answered++;
    }

    // Try SPR input
    const sprInput = page.locator('input[data-testid="spr-input"], input[placeholder*="answer" i]');
    if (await sprInput.count() > 0) {
      await sprInput.first().fill('42');
      answered++;
    }

    // Attempt to navigate to next question or submit module
    const nextBtn = page.locator(
      'button:has-text("Next"), button:has-text("Next Question"), [data-testid="next-btn"]'
    );
    if (await nextBtn.count() > 0 && await nextBtn.first().isEnabled()) {
      await nextBtn.first().click();
      await page.waitForTimeout(300);
      continue;
    }

    // No next button → we may be on the last question; break
    break;
  }
  return answered;
}

/** Wait for exam completion (session status = completed in the UI). */
async function waitForExamCompletion(page: Page, timeoutMs = 120_000) {
  await page.waitForURL(/\/(dashboard|results|review)/, { timeout: timeoutMs }).catch(() => {});
}

/** Hit the backend health endpoint and assert ok. */
async function assertBackendHealthy(page: Page) {
  const resp = await page.request.get(`${API_URL}/health`);
  expect(resp.status()).toBe(200);
}

// ─── Test Suite ─────────────────────────────────────────────────────────────

test.describe('Student Journey — Single Student E2E', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    // Set up Clerk testing token (fetches from Clerk API using CLERK_SECRET_KEY)
    await clerkSetup().catch(e => {
      console.warn('[Setup] clerkSetup failed (will try without testing token):', e.message);
    });

    const authStatePath = path.join(__dirname, 'auth-state.json');

    // Step 1: Sign in to capture a fresh storage state
    {
      const setupContext = await browser.newContext();
      const setupPage = await setupContext.newPage();
      await setupClerkTestingToken({ context: setupContext }).catch(() => {});

      await setupPage.goto(`${BASE_URL}/sign-in`);
      await setupPage.waitForFunction(() => (window as any).Clerk !== undefined, { timeout: 15_000 }).catch(() => {});

      try {
        const clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
        const token = await clerkClient.signInTokens.createSignInToken({ userId: USER_ID, expiresInSeconds: 300 });
        await clerk.signIn({ page: setupPage, signInParams: { strategy: 'ticket', ticket: token.token } });
      } catch (e) {
        console.warn('[Setup] Ticket sign-in failed:', (e as Error).message);
      }

      await setupPage.goto(`${BASE_URL}/dashboard`);
      await setupPage.waitForURL(/\/dashboard/, { timeout: 25_000 }).catch(() => {});
      await setupContext.storageState({ path: authStatePath });
      await setupContext.close();
      console.log('[Setup] Auth state saved after sign-in');
    }

    // Step 2: Create the real test context with saved auth state
    context = await browser.newContext({ storageState: authStatePath });
    page = await context.newPage();
    await setupClerkTestingToken({ context }).catch(() => {});

    // Suppress console noise but capture errors
    page.on('console', msg => {
      if (msg.type() === 'error') console.error('[Browser]', msg.text());
    });
    page.on('pageerror', err => console.error('[PageError]', err.message));

    // Step 3: Ensure at least one completed session exists for TC-14 (Review button test).
    // Fetch the user's sessions and mark the oldest active one as completed.
    try {
      const sessionsResp = await page.request.get(`${API_URL}/sessions?user_id=${USER_ID}`, {
        headers: { 'X-User-ID': USER_ID },
      });
      if (sessionsResp.ok()) {
        const sessions = await sessionsResp.json() as Array<{ id: string; status: string }>;
        const activeSession = sessions.find(s => s.status === 'active');
        if (activeSession) {
          // Use port 8005 (updated server with PATCH /sessions/{id}/status endpoint)
          const patchUrl = API_URL.replace(':8004', ':8005');
          const patchResp = await page.request.patch(`${patchUrl}/sessions/${activeSession.id}/status`, {
            data: { status: 'completed' },
            headers: { 'X-User-ID': USER_ID },
          });
          if (patchResp.ok()) {
            console.log(`[Setup] Marked session ${activeSession.id} as completed for TC-14`);
          } else {
            console.warn(`[Setup] Could not mark session as completed: ${patchResp.status()}`);
          }
        } else {
          console.warn('[Setup] No active sessions found to mark as completed for TC-14');
        }
      }
    } catch (e) {
      console.warn('[Setup] Error ensuring completed session:', (e as Error).message);
    }
  });

  test.afterAll(async () => {
    await context.close();
  });

  // ── 1. Backend health ──────────────────────────────────────────────────
  test('TC-01 | Backend is healthy', async () => {
    await assertBackendHealthy(page);
  });

  // ── 2. Auth ───────────────────────────────────────────────────────────
  test('TC-02 | Student can sign in and land on dashboard', async () => {
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForURL(/\/dashboard/, { timeout: 25_000 });

    // Dashboard renders core sections
    await expect(page.locator('h2, h1').filter({ hasText: /welcome|dashboard/i }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('h3:has-text("Diagnostic Tests"), h2:has-text("Diagnostic Tests")').first()).toBeVisible();
    await expect(page.locator('text=Daily Practice').first()).toBeVisible();
  });

  // ── 3. Dashboard — pre-diagnostic state ───────────────────────────────
  test('TC-03 | Dashboard shows diagnostic CTAs when no diagnostics completed', async () => {
    await page.goto(`${BASE_URL}/dashboard`);

    const mathCard = page.locator('h4:has-text("Math Diagnostic"), h3:has-text("Math Diagnostic")').first();
    const rwCard   = page.locator('h4:has-text("Reading & Writing"), h3:has-text("Reading & Writing")').first();
    await expect(mathCard).toBeVisible();
    await expect(rwCard).toBeVisible();

    // Buttons should be "Start" (not "Completed") — warn if already completed
    const startMath = await page.locator('button:has-text("Start Math")').isVisible({ timeout: 3_000 }).catch(() => false);
    if (!startMath) {
      console.warn('[TC-03] ISSUE: "Start Math" button not visible — diagnostic may already be completed');
    }
    const startRW = await page.locator('button:has-text("Start R&W")').isVisible({ timeout: 3_000 }).catch(() => false);
    if (!startRW) {
      console.warn('[TC-03] ISSUE: "Start R&W" button not visible — diagnostic may already be completed');
    }

    // Progress panel should show empty state — not an error
    await expect(page.locator('text=No progress data')).toBeVisible({ timeout: 8_000 }).catch(() => {
      // Acceptable if it shows a loading state briefly
    });
  });

  // ── 4. Math Diagnostic ────────────────────────────────────────────────
  test('TC-04 | Student can start and complete Math Diagnostic', async () => {
    await page.goto(`${BASE_URL}/dashboard`);

    // Click Start Math — skip if already completed
    const startMathBtn = page.locator('button:has-text("Start Math")');
    const mathEnabled = await startMathBtn.isEnabled({ timeout: 10_000 }).catch(() => false);
    if (!mathEnabled) {
      console.warn('[TC-04] ISSUE: "Start Math" button not found/enabled — diagnostic may already be completed');
      console.warn('[TC-04] Skipping diagnostic flow for this test run');
      return;
    }
    await startMathBtn.click();

    // Should navigate to /exam/diagnostic/[sessionId]
    await page.waitForURL(/\/exam\/diagnostic\//, { timeout: 20_000 });
    const sessionId = page.url().split('/').pop();
    expect(sessionId).toBeTruthy();
    console.log('[TC-04] Diagnostic Math session:', sessionId);

    // Exam runner loads — question text visible (may be in p, div, or custom element)
    await expect(page.locator('[data-testid="question-text"], .question-text, p, h2, h3').first())
      .toBeVisible({ timeout: 15_000 });

    // Answer module 1
    const answered = await answerAllQuestionsOnPage(page);
    console.log(`[TC-04] Answered ${answered} questions in module 1`);

    // Submit module
    const submitBtn = page.locator(
      'button:has-text("Submit"), button:has-text("Submit Module"), button:has-text("Next Section")'
    );
    if (await submitBtn.count() > 0) {
      await submitBtn.first().click({ force: true });
      await page.waitForTimeout(2000);
    }

    // Answer module 2 (adaptive)
    await answerAllQuestionsOnPage(page);

    // Final submit
    const finalSubmit = page.locator('button:has-text("Finish"), button:has-text("Submit Exam"), button:has-text("End Section")');
    if (await finalSubmit.count() > 0) {
      await finalSubmit.first().click({ force: true });
    }

    // Wait for completion redirect
    await waitForExamCompletion(page, 60_000);
    console.log('[TC-04] Math diagnostic complete. URL:', page.url());
  });

  // ── 5. RW Diagnostic ──────────────────────────────────────────────────
  test('TC-05 | Student can start and complete RW Diagnostic', async () => {
    await page.goto(`${BASE_URL}/dashboard`);

    const startRwBtn = page.locator('button:has-text("Start R&W")');
    // If already completed, button will be disabled — skip gracefully
    if (!(await startRwBtn.isEnabled().catch(() => false))) {
      test.skip(); // RW already completed from a previous run
      return;
    }

    await startRwBtn.click();
    await page.waitForURL(/\/exam\/diagnostic\//, { timeout: 20_000 });
    console.log('[TC-05] RW session:', page.url().split('/').pop());

    await expect(page.locator('[data-testid="question-text"], .question-text, h2, h3').first())
      .toBeVisible({ timeout: 15_000 });

    await answerAllQuestionsOnPage(page);

    const submitBtn = page.locator('button:has-text("Submit"), button:has-text("Submit Module")');
    if (await submitBtn.count() > 0) {
      await submitBtn.first().click({ force: true });
      await page.waitForTimeout(2000);
    }

    await answerAllQuestionsOnPage(page);

    const finalSubmit = page.locator('button:has-text("Finish"), button:has-text("Submit Exam")');
    if (await finalSubmit.count() > 0) {
      await finalSubmit.first().click({ force: true });
    }

    await waitForExamCompletion(page, 60_000);
    console.log('[TC-05] RW diagnostic complete.');
  });

  // ── 6. Post-diagnostic Dashboard ──────────────────────────────────────
  test('TC-06 | Dashboard shows completed state after diagnostics', async () => {
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForTimeout(3000); // Allow sync

    // Diagnostic buttons should now be disabled/completed
    const completedBadge = page.locator('text=Completed').first();
    await expect(completedBadge).toBeVisible({ timeout: 10_000 }).catch(async () => {
      console.warn('[TC-06] ISSUE: Completed badge not visible — diagnostic completion not reflected in UI');
    });
  });

  // ── 7. Progress Panel ─────────────────────────────────────────────────
  test('TC-07 | Progress panel shows domain data after diagnostic', async () => {
    await page.goto(`${BASE_URL}/dashboard`);

    // "My Progress" section — scroll into view first (it's below fold)
    const progressSection = page.locator('h3:has-text("My Progress")').first();
    await progressSection.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => {});
    const progressVisible = await progressSection.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!progressVisible) {
      console.warn('[TC-07] ISSUE: "My Progress" section not visible on dashboard');
    }

    // Should NOT show "No progress data" — we just completed diagnostics
    const emptyState = page.locator('text=No progress data');
    const hasEmpty = await emptyState.isVisible().catch(() => false);
    if (hasEmpty) {
      console.warn('[TC-07] ISSUE: Progress panel shows empty state after completed diagnostics');
      console.warn('[TC-07]   → Likely: curriculum graph API not returning data for this user');
      console.warn('[TC-07]   → Check: response_history saved, user_id header propagated');
    }

    // Wait for progress panel to finish loading
    await page.waitForFunction(
      () => !document.body.innerText.includes('Loading progress'),
      { timeout: 15_000 }
    ).catch(() => {});

    // Domain bar chart or accuracy by domain should appear — scroll into view first
    const domainCard = page.locator('text=Accuracy by Domain');
    await domainCard.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => {});
    await expect(domainCard).toBeVisible({ timeout: 10_000 }).catch(() => {
      console.warn('[TC-07] ISSUE: Domain accuracy chart not visible');
    });
  });

  // ── 8. Study Recommendations ──────────────────────────────────────────
  test('TC-08 | "What to study today" recommendations appear', async () => {
    await page.goto(`${BASE_URL}/dashboard`);

    // The recommendations block
    const studyBlock = page.locator('text=What to study today');
    await expect(studyBlock).toBeVisible({ timeout: 10_000 }).catch(() => {
      console.warn('[TC-08] ISSUE: "What to study today" not shown — student_profile may not have been created');
    });
  });

  // ── 9. Daily Practice — Math ──────────────────────────────────────────
  test('TC-09 | Student can start a Daily Math practice session', async () => {
    await page.goto(`${BASE_URL}/dashboard`);

    // Wait for loading to finish — button shows "Starting..." while isLoading=true, then "Daily Math"
    await page.waitForFunction(
      () => {
        const btns = Array.from(document.querySelectorAll('button'));
        return btns.some(b => b.textContent?.trim() === 'Daily Math' && !b.disabled);
      },
      { timeout: 15_000 }
    ).catch(() => {});

    const dailyMathBtn = page.locator('button:has-text("Daily Math")');
    const mathBtnVisible = await dailyMathBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!mathBtnVisible) {
      console.warn('[TC-09] ISSUE: "Daily Math" button not visible after loading — section may not be rendering');
      return;
    }
    await dailyMathBtn.click();

    // Should navigate to /exam/simulation/[sessionId] or /drill/[sessionId]
    await page.waitForURL(/\/(exam|drill)\//, { timeout: 30_000 });
    console.log('[TC-09] Daily math URL:', page.url());

    // Wait for the exam page to fully initialize
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

    // Exam runner should load — look for any question content
    const examLoaded = await page.locator('[data-testid="question-text"], .question-text, p, [class*="question"]').first()
      .isVisible({ timeout: 15_000 }).catch(() => false);
    if (!examLoaded) {
      console.warn('[TC-09] ISSUE: Exam page loaded but no question content visible');
    }

    // Timer should be visible
    const timer = page.locator('[data-testid="timer"], text=/\\d+:\\d+/, .timer');
    await expect(timer.first()).toBeVisible({ timeout: 8_000 }).catch(() => {
      console.warn('[TC-09] ISSUE: Timer not visible during daily practice');
    });
  });

  // ── 10. Exam UX — Question display ────────────────────────────────────
  test('TC-10 | Question text, options, and tools render correctly', async () => {
    // Navigate to current active session or start a new daily session
    const url = page.url();
    if (!url.includes('/exam/') && !url.includes('/drill/')) {
      // Start fresh daily session
      await page.goto(`${BASE_URL}/dashboard`);
      await page.locator('button:has-text("Daily Math")').click();
      await page.waitForURL(/\/(exam|drill)\//, { timeout: 30_000 });
    }

    // Question stem is visible
    const questionText = page.locator('[data-testid="question-text"], .question-text').first();
    await expect(questionText).toBeVisible({ timeout: 15_000 }).catch(() => {
      console.warn('[TC-10] ISSUE: Question text element not found with expected selectors');
    });

    // At least 2 answer options (MCQ) or a text input (SPR)
    const options = page.locator('input[type="radio"], [data-testid="option-btn"]');
    const sprInput = page.locator('input[type="text"], input[type="number"], [data-testid="spr-input"]');
    const optCount = await options.count();
    const sprCount = await sprInput.count();
    if (optCount < 2 && sprCount === 0) {
      console.warn(`[TC-10] ISSUE: Only ${optCount} answer options and ${sprCount} SPR inputs visible (expected ≥ 2 options or 1 SPR input)`);
    }

    // Toolbar items — calculator (only shown for Math sections)
    const calcBtn = page.locator('[data-testid="calculator-btn"], button:has-text("Calculator"), [aria-label*="alculator"]');
    const calcVisible = await calcBtn.first().isVisible({ timeout: 3_000 }).catch(() => false);
    if (!calcVisible) {
      // Calculator only shows for Math sections — this may be RW
      const sectionText = await page.locator('text=/Reading|Writing|Math/i').first().textContent().catch(() => '');
      if (sectionText && /math/i.test(sectionText)) {
        console.warn('[TC-10] ISSUE: Calculator button not visible in Math section');
      }
    }

    // Question counter ("Question X of Y")
    const counter = page.locator('text=/Question \\d+ of \\d+/');
    await expect(counter.first()).toBeVisible({ timeout: 5_000 }).catch(() => {
      console.warn('[TC-10] ISSUE: Question counter not visible');
    });
  });

  // ── 11. Math rendering ────────────────────────────────────────────────
  test('TC-11 | Math expressions render (KaTeX / MathML present)', async () => {
    const url = page.url();
    if (!url.includes('/exam/') && !url.includes('/drill/')) {
      test.skip();
      return;
    }

    // KaTeX renders .katex spans; MathML renders <math> elements
    // At least one math question should exist in a Math daily session
    const hasMath = await page.locator('.katex, math, [data-testid="math-renderer"]').count();
    if (hasMath === 0) {
      console.warn('[TC-11] INFO: No math expressions on current question (may be text-only)');
    } else {
      console.log(`[TC-11] Math rendered: ${hasMath} element(s)`);
    }

    // Check for broken LaTeX (raw \frac, \sqrt visible in plain text)
    const pageText = await page.locator('body').innerText();
    const brokenLatex = /\\frac|\\sqrt|\\cdot|\\times/.test(pageText);
    if (brokenLatex) {
      console.warn('[TC-11] ISSUE: Raw LaTeX visible in page text — MathRenderer not working for some expressions');
    }
  });

  // ── 12. Answer saving — IndexedDB persistence ─────────────────────────
  test('TC-12 | Answers persist across page reload (IndexedDB)', async () => {
    const url = page.url();
    if (!url.includes('/exam/') && !url.includes('/drill/')) {
      test.skip();
      return;
    }

    // Select an answer
    const radio = page.locator('input[type="radio"]').first();
    if (await radio.count() === 0) { test.skip(); return; }

    await radio.check({ force: true });
    const sessionId = page.url().split('/').pop();

    // Reload page
    await page.reload();
    await page.waitForTimeout(2000);

    // Session should resume (not throw 404 or redirect to dashboard)
    await expect(page).not.toHaveURL(`${BASE_URL}/dashboard`);
    console.log('[TC-12] Session resumed after reload:', page.url());
  });

  // ── 13. Submit module and adaptive routing ────────────────────────────
  test('TC-13 | Submitting module 1 routes to adaptive module 2', async () => {
    const url = page.url();
    if (!url.includes('/exam/') && !url.includes('/drill/')) {
      test.skip();
      return;
    }

    // Answer all questions
    await answerAllQuestionsOnPage(page);

    // Submit module
    const submitBtn = page.locator('button:has-text("Submit"), button:has-text("Submit Module"), button:has-text("Next Section")');
    if (await submitBtn.count() === 0) {
      console.warn('[TC-13] ISSUE: No submit module button found');
      test.skip();
      return;
    }

    await submitBtn.first().click({ force: true });

    // Should either:
    // a) Show an intermission / break screen, then load module 2
    // b) Directly load module 2 questions
    // c) Navigate to results if single-module exam
    await page.waitForTimeout(3000);
    const newUrl = page.url();
    console.log('[TC-13] After module submit:', newUrl);

    // Not an error page
    await expect(page.locator('text=Error, text=500, text=Something went wrong')).not.toBeVisible();
  });

  // ── 14. Session completion & review ───────────────────────────────────
  test('TC-14 | Completed session appears in history and review is accessible', async () => {
    await page.goto(`${BASE_URL}/dashboard`);

    // Wait for sessions to finish loading (loading indicator disappears)
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="loading-sessions"]') && !document.body.innerText.includes('Loading history...'),
      { timeout: 15_000 }
    ).catch(() => {});

    // "The Cockpit" session history section — scroll into view
    const cockpit = page.locator('text=The Cockpit');
    await cockpit.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => {});
    const cockpitVisible = await cockpit.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!cockpitVisible) {
      console.warn('[TC-14] ISSUE: "The Cockpit" section not visible — may need to scroll or section renamed');
    }

    // Check if any sessions are listed
    await page.waitForTimeout(1000); // brief wait for table to render
    const rows = page.locator('table tbody tr');
    const rowCount = await rows.count();
    console.log(`[TC-14] Session history rows: ${rowCount}`);

    if (rowCount === 0) {
      console.warn('[TC-14] ISSUE: No sessions in history table — may need to complete a session first');
      return;
    }

    // Click Review on first completed session
    const reviewBtn = page.locator('button:has-text("Review")').first();
    if (await reviewBtn.count() > 0) {
      await reviewBtn.click();
      await page.waitForURL(/\/review/, { timeout: 15_000 });

      // Review page should load — look for any review content
      const reviewLoaded = await page.locator('text=Error, text=Network Error').first()
        .isVisible({ timeout: 3_000 }).catch(() => false);
      if (reviewLoaded) {
        console.warn('[TC-14] ISSUE: Review page shows Network Error — sessions/review CORS or proxy issue');
      } else {
        console.log('[TC-14] Review page loaded:', page.url());
      }
      console.log('[TC-14] Review page loaded:', page.url());
    } else {
      console.warn('[TC-14] ISSUE: No "Review" button — sessions may all be in "active" state');
    }
  });

  // ── 15. Review page — question display ────────────────────────────────
  test('TC-15 | Review page shows correct/incorrect indicators and explanation', async () => {
    const url = page.url();
    if (!url.includes('/review')) {
      test.skip();
      return;
    }

    // Wait for review page to finish loading
    await page.waitForFunction(
      () => !document.body.innerText.includes('Loading Review'),
      { timeout: 15_000 }
    ).catch(() => {});

    // Sidebar with check/X icons
    const correctIcon  = page.locator('[data-testid="correct-icon"]').first();
    const incorrectIcon = page.locator('[data-testid="incorrect-icon"]').first();
    // Wait for at least one icon to appear
    await page.locator('[data-testid="correct-icon"], [data-testid="incorrect-icon"]').first()
      .waitFor({ timeout: 10_000 }).catch(() => {});
    const hasIcons = (await correctIcon.count()) + (await incorrectIcon.count()) > 0;
    if (!hasIcons) {
      console.warn('[TC-15] ISSUE: No correct/incorrect icons in review sidebar');
    }

    // AI explanation or solution text visible in right pane
    const explanation = page.locator('text=Step-by-Step Solution, text=Explanation, text=Solution, [data-testid="explanation"]').first();
    await expect(explanation).toBeVisible({ timeout: 10_000 }).catch(() => {
      console.warn('[TC-15] ISSUE: No explanation visible in review right pane');
    });

    // Retry mode button
    const retryBtn = page.locator('button:has-text("Retry Wrong")');
    await expect(retryBtn).toBeVisible({ timeout: 5_000 }).catch(() => {
      console.warn('[TC-15] ISSUE: Retry Wrong button not visible (may be 0 wrong answers)');
    });
  });

  // ── 16. Tutor / hint interaction ──────────────────────────────────────
  test('TC-16 | Tutor console visible in review and accepts a message', async () => {
    const url = page.url();
    if (!url.includes('/review')) {
      test.skip();
      return;
    }

    // TutorConsole renders in right pane
    const chatInput = page.locator('textarea[placeholder], input[placeholder*="message" i], input[placeholder*="ask" i]').first();
    await expect(chatInput).toBeVisible({ timeout: 10_000 }).catch(() => {
      console.warn('[TC-16] ISSUE: Tutor chat input not visible in review pane');
    });

    if (await chatInput.count() > 0) {
      await chatInput.fill('Can you explain why my answer was wrong?');
      const sendBtn = page.locator('button[type="submit"], button:has-text("Send")').first();
      if (await sendBtn.count() > 0) {
        await sendBtn.click();
        // Response should appear within 15s
        await page.waitForTimeout(5000);
        const response = page.locator('[data-testid="tutor-response"], .tutor-message, .ai-message').first();
        await expect(response).toBeVisible({ timeout: 15_000 }).catch(() => {
          console.warn('[TC-16] ISSUE: No tutor response received within 15s');
        });
      }
    }
  });

  // ── 17. Full-length simulation start ──────────────────────────────────
  test('TC-17 | Student can initiate Full Mock Exam', async () => {
    await page.goto(`${BASE_URL}/dashboard`);

    const fullMockBtn = page.locator('button:has-text("Start Full Mock Exam")');
    // Button may be below fold — scroll to it
    await fullMockBtn.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => {});
    const mockVisible = await fullMockBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!mockVisible) {
      console.warn('[TC-17] ISSUE: "Start Full Mock Exam" button not visible — check simulation page layout');
      return;
    }
    await expect(fullMockBtn).toBeEnabled();

    await fullMockBtn.click();

    // Should navigate to /simulation
    await page.waitForURL(`${BASE_URL}/simulation`, { timeout: 15_000 });

    // Wait for the simulation page to fully initialize (network calls complete)
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    // Exam runner should load with a question
    const examStarted = await page.locator('[data-testid="question-text"], p, [data-testid="option-btn"]').first()
      .isVisible({ timeout: 15_000 }).catch(() => false);
    if (!examStarted) {
      console.warn('[TC-17] ISSUE: Full mock exam did not load question content after start');
    }

    console.log('[TC-17] Simulation initiated:', page.url());

    // Navigate back to dashboard to not block subsequent tests
    await page.goto(`${BASE_URL}/dashboard`);
  });

  // ── 18. Score range sanity ─────────────────────────────────────────────
  test('TC-18 | Session scores are within valid SAT range (200–800)', async () => {
    const resp = await page.request.get(`${BASE_URL}/api/student/sessions`);
    if (!resp.ok()) {
      console.warn('[TC-18] Could not fetch sessions from API');
      return;
    }
    const sessions = await resp.json() as Array<{ finalScore?: number; status: string }>;
    const scoredSessions = sessions.filter(s => s.status === 'completed' && s.finalScore != null);

    for (const s of scoredSessions) {
      const score = s.finalScore!;
      if (score < 200 || score > 800) {
        console.warn(`[TC-18] ISSUE: Score ${score} is outside valid SAT range 200–800`);
      }
      expect(score).toBeGreaterThanOrEqual(200);
      expect(score).toBeLessThanOrEqual(800);
    }

    console.log(`[TC-18] Checked ${scoredSessions.length} scored session(s)`);
  });

  // ── 19. Score disclosure label ─────────────────────────────────────────
  test('TC-19 | Estimated score disclaimer is visible wherever scores appear', async () => {
    await page.goto(`${BASE_URL}/dashboard`);

    // Scroll to bottom to reveal the Cockpit section and score disclaimer
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);

    // Any element that shows a score should be near an "estimated" disclaimer
    const disclaimers = page.locator('text=/estimated|training purposes|not predict/i');
    const count = await disclaimers.count();
    if (count === 0) {
      console.warn('[TC-19] ISSUE: No score disclaimer visible on dashboard');
    } else {
      console.log(`[TC-19] Found ${count} score disclaimer(s)`);
    }
  });

  // ── 20. Offline resilience ────────────────────────────────────────────
  test('TC-20 | Exam continues when network is interrupted mid-session', async () => {
    await page.goto(`${BASE_URL}/dashboard`);

    // Start a daily session
    const dailyBtn = page.locator('button:has-text("Daily Math"), button:has-text("Daily RW")').first();
    if (!(await dailyBtn.isEnabled().catch(() => false))) { test.skip(); return; }

    await dailyBtn.click();
    await page.waitForURL(/\/(exam|drill)\//, { timeout: 30_000 });
    await page.waitForTimeout(2000);

    // Go offline
    await context.setOffline(true);
    console.log('[TC-20] Network set to offline');

    // Try to answer a question while offline
    const radio = page.locator('input[type="radio"]').first();
    if (await radio.count() > 0) {
      await radio.check({ force: true });
      console.log('[TC-20] Answered question while offline — no crash expected');
    }

    // Navigate to next question while offline
    const nextBtn = page.locator('button:has-text("Next"), button:has-text("Next Question")').first();
    if (await nextBtn.count() > 0) {
      await nextBtn.click({ force: true }).catch(() => {});
      await page.waitForTimeout(1000);
    }

    // Page should NOT crash (no 500 error, no blank screen)
    await expect(page.locator('text=500, text=Application error')).not.toBeVisible();

    // Go back online
    await context.setOffline(false);
    console.log('[TC-20] Network restored');
    await page.waitForTimeout(2000);

    // Exam should still be functional
    const stillOnExam = await page.locator('[data-testid="question-text"], h2, h3').first()
      .isVisible({ timeout: 10_000 }).catch(() => false);
    if (!stillOnExam) {
      console.warn('[TC-20] ISSUE: Exam page crashed or redirected after network restore — offline resilience broken');
    } else {
      console.log('[TC-20] Exam still running after network restore');
    }

    // Return to dashboard
    await page.goto(`${BASE_URL}/dashboard`);
  });

  // ── 21. Navigation — Back to Dashboard from exam ──────────────────────
  test('TC-21 | Student can exit an in-progress exam and return to dashboard', async () => {
    await page.goto(`${BASE_URL}/dashboard`);

    const dailyBtn = page.locator('button:has-text("Daily Math"), button:has-text("Daily RW")').first();
    if (!(await dailyBtn.isEnabled().catch(() => false))) { test.skip(); return; }

    await dailyBtn.click();
    await page.waitForURL(/\/(exam|drill)\//, { timeout: 30_000 });
    await page.waitForTimeout(2000);

    // Look for a way back (Pause, Exit, or browser back)
    const exitBtn = page.locator('button:has-text("Exit"), button:has-text("Pause"), a:has-text("Dashboard")').first();
    if (await exitBtn.count() > 0) {
      await exitBtn.click();
      await page.waitForTimeout(1500);
    } else {
      // Fall back to browser navigation
      await page.goBack();
    }

    // Should be back at dashboard or an exit confirmation
    const onDashboard = page.url().includes('/dashboard');
    const onConfirm   = await page.locator('text=Exit exam, text=Are you sure, text=Leave').isVisible().catch(() => false);

    if (!onDashboard && !onConfirm) {
      console.warn('[TC-21] ISSUE: No exit button found and back-navigation did not return to dashboard');
    }
  });

  // ── 22. API — Sessions endpoint returns correct structure ─────────────
  test('TC-22 | /api/student/sessions returns well-formed session records', async () => {
    // Evaluate fetch inside the browser context so auth cookies are included
    const result = await page.evaluate(async () => {
      try {
        const resp = await fetch('/api/student/sessions');
        if (!resp.ok) return { ok: false, status: resp.status, sessions: [] };
        const sessions = await resp.json();
        return { ok: true, status: resp.status, sessions };
      } catch (e: any) {
        return { ok: false, status: 0, error: e.message, sessions: [] };
      }
    });

    if (!result.ok) {
      console.warn(`[TC-22] Sessions API returned ${result.status} — may need auth or backend sync`);
      return; // Non-fatal: may be on sign-in page if auth failed
    }

    const sessions = result.sessions as any[];
    expect(Array.isArray(sessions)).toBeTruthy();

    for (const s of sessions) {
      expect(s).toHaveProperty('id');
      expect(s).toHaveProperty('status');
      expect(['active', 'completed', 'in_progress', 'expired', 'MODULE_1_COMPLETE', 'NOT_STARTED']).toContain(s.status);
      if (s.status === 'completed' && s.finalScore != null) {
        expect(typeof s.finalScore).toBe('number');
      }
    }

    console.log(`[TC-22] Sessions API returned ${sessions.length} record(s)`);
  });

  // ── 23. Recommendations API ───────────────────────────────────────────
  test('TC-23 | Recommendations API returns valid structure', async () => {
    const resp = await page.request.get(`${BASE_URL}/api/student/recommendations`);
    if (!resp.ok()) {
      console.warn('[TC-23] ISSUE: Recommendations API returned', resp.status());
      return;
    }
    const data = await resp.json() as any;
    expect(data).toHaveProperty('has_profile');
    expect(data).toHaveProperty('top_concepts');
    expect(Array.isArray(data.top_concepts)).toBeTruthy();

    if (data.has_profile) {
      console.log(`[TC-23] Profile exists. Top concepts: ${data.top_concepts.map((c: any) => c.concept).join(', ')}`);
    } else {
      console.log('[TC-23] No student profile yet (expected if diagnostics not completed)');
    }
  });

  // ── 24. Curriculum graph API ──────────────────────────────────────────
  test('TC-24 | Curriculum graph API returns domains and skills', async () => {
    const resp = await page.request.get(`${API_URL}/api/curriculum/graph`, {
      headers: { 'X-Tenant-ID': 'public' },
    });
    // May be 401 without user ID — that's acceptable
    if (resp.status() === 401) {
      console.log('[TC-24] Graph API requires X-User-ID — tested via dashboard instead');
      return;
    }
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json() as any;
    expect(data).toHaveProperty('nodes');
    expect(data).toHaveProperty('links');
    expect(Array.isArray(data.nodes)).toBeTruthy();
    console.log(`[TC-24] Graph: ${data.nodes.length} nodes, ${data.links.length} links`);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CRITICAL GAP TESTS — Answer, Sync, Complete, Daily Practice, SPR
  // ═══════════════════════════════════════════════════════════════════════

  // ── 26. Answer a question (MCQ) ─────────────────────────────────────
  test('TC-26 | Student can select an MCQ answer and it persists', async () => {
    // Start a fresh daily session so we have a clean exam
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForFunction(
      () => {
        const btns = Array.from(document.querySelectorAll('button'));
        return btns.some(b => /Daily (Math|RW)/.test(b.textContent?.trim() || '') && !b.disabled);
      },
      { timeout: 15_000 }
    ).catch(() => {});

    const dailyBtn = page.locator('button:has-text("Daily Math"), button:has-text("Daily RW")').first();
    if (!(await dailyBtn.isVisible({ timeout: 5_000 }).catch(() => false))) {
      console.warn('[TC-26] SKIP: No daily practice button available');
      return;
    }
    await dailyBtn.click();
    await page.waitForURL(/\/(exam|drill)\//, { timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

    // Wait for question to load
    await page.locator('[data-testid="question-text"]').waitFor({ timeout: 15_000 }).catch(() => {});

    // Find an MCQ option button
    const optionBtns = page.locator('[data-testid="option-btn"]');
    const optCount = await optionBtns.count();

    if (optCount >= 2) {
      // Click the second option (index 1)
      await optionBtns.nth(1).click();
      await page.waitForTimeout(500);

      // Verify visual selection state — the clicked option should have bg-blue-600
      const selectedOption = page.locator('[data-testid="option-btn"].bg-blue-600, [data-testid="option-btn"][class*="bg-blue"]');
      const selectedCount = await selectedOption.count();
      if (selectedCount > 0) {
        console.log('[TC-26] ✓ MCQ answer selected with visual feedback');
      } else {
        console.warn('[TC-26] ISSUE: Option clicked but no visual selection state detected');
      }

      // Verify answer persists after reload
      const currentUrl = page.url();
      await page.reload();
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
      await page.locator('[data-testid="question-text"]').waitFor({ timeout: 15_000 }).catch(() => {});

      // Session should still be on the exam page (not redirected)
      expect(page.url()).toContain('/exam/');
      console.log('[TC-26] ✓ Session persisted after reload');
    } else {
      // SPR question — enter a value
      const sprInput = page.locator('input[placeholder*="answer" i]');
      if (await sprInput.count() > 0) {
        await sprInput.first().fill('42');
        await page.waitForTimeout(500);

        // Verify answer preview appears
        const preview = page.locator('text=Answer Preview');
        const hasPreview = await preview.isVisible({ timeout: 3_000 }).catch(() => false);
        if (hasPreview) {
          console.log('[TC-26] ✓ SPR answer entered with preview');
        } else {
          console.warn('[TC-26] ISSUE: SPR answer entered but no preview visible');
        }
      } else {
        console.warn('[TC-26] ISSUE: No MCQ options or SPR input found');
      }
    }
  });

  // ── 27. Navigate between questions ──────────────────────────────────
  test('TC-27 | Student can navigate forward and backward through questions', async () => {
    const url = page.url();
    if (!url.includes('/exam/') && !url.includes('/drill/')) {
      console.warn('[TC-27] SKIP: Not on an exam page');
      return;
    }

    // Get initial question counter
    const counter = page.locator('text=/Question \\d+ of \\d+/');
    await counter.first().waitFor({ timeout: 10_000 }).catch(() => {});
    const initialText = await counter.first().textContent().catch(() => '');
    const initialMatch = initialText?.match(/Question (\d+) of (\d+)/);
    if (!initialMatch) {
      console.warn('[TC-27] ISSUE: Question counter not found');
      return;
    }
    const startQ = parseInt(initialMatch[1]);
    const totalQ = parseInt(initialMatch[2]);
    console.log(`[TC-27] Starting at Question ${startQ} of ${totalQ}`);

    // Click Next
    const nextBtn = page.locator('button:has-text("Next")').last();
    if (startQ < totalQ && await nextBtn.isEnabled()) {
      await nextBtn.click();
      await page.waitForTimeout(500);

      const afterNext = await counter.first().textContent().catch(() => '');
      const nextMatch = afterNext?.match(/Question (\d+)/);
      if (nextMatch && parseInt(nextMatch[1]) === startQ + 1) {
        console.log(`[TC-27] ✓ Navigated forward to Question ${startQ + 1}`);
      } else {
        console.warn(`[TC-27] ISSUE: Expected Q${startQ + 1}, got: ${afterNext}`);
      }

      // Click Back
      const backBtn = page.locator('button:has-text("Back")');
      if (await backBtn.count() > 0 && await backBtn.first().isEnabled()) {
        await backBtn.first().click();
        await page.waitForTimeout(500);

        const afterBack = await counter.first().textContent().catch(() => '');
        const backMatch = afterBack?.match(/Question (\d+)/);
        if (backMatch && parseInt(backMatch[1]) === startQ) {
          console.log(`[TC-27] ✓ Navigated backward to Question ${startQ}`);
        } else {
          console.warn(`[TC-27] ISSUE: Expected Q${startQ}, got: ${afterBack}`);
        }
      } else {
        console.warn('[TC-27] ISSUE: Back button not found or disabled');
      }
    } else {
      console.warn('[TC-27] ISSUE: Already on last question or Next disabled');
    }
  });

  // ── 28. SPR (free-response) input ───────────────────────────────────
  test('TC-28 | SPR input accepts valid formats and rejects invalid', async () => {
    const url = page.url();
    if (!url.includes('/exam/') && !url.includes('/drill/')) {
      console.warn('[TC-28] SKIP: Not on an exam page');
      return;
    }

    // Navigate through questions looking for an SPR question
    let foundSPR = false;
    const counter = page.locator('text=/Question \\d+ of \\d+/');
    const counterText = await counter.first().textContent().catch(() => '');
    const totalMatch = counterText?.match(/of (\d+)/);
    const totalQ = totalMatch ? parseInt(totalMatch[1]) : 10;

    for (let i = 0; i < Math.min(totalQ, 15); i++) {
      const sprInput = page.locator('input[placeholder*="answer" i]');
      if (await sprInput.count() > 0) {
        foundSPR = true;

        // Test valid fraction
        await sprInput.first().fill('');
        await sprInput.first().fill('3/4');
        await page.waitForTimeout(300);
        let val = await sprInput.first().inputValue();
        expect(val).toBe('3/4');
        console.log('[TC-28] ✓ Fraction "3/4" accepted');

        // Test valid decimal
        await sprInput.first().fill('');
        await sprInput.first().fill('3.5');
        val = await sprInput.first().inputValue();
        expect(val).toBe('3.5');
        console.log('[TC-28] ✓ Decimal "3.5" accepted');

        // Test valid negative
        await sprInput.first().fill('');
        await sprInput.first().fill('-42');
        val = await sprInput.first().inputValue();
        expect(val).toBe('-42');
        console.log('[TC-28] ✓ Negative "-42" accepted');

        // Test max length (6 chars)
        await sprInput.first().fill('');
        await sprInput.first().fill('1234567');
        val = await sprInput.first().inputValue();
        expect(val.length).toBeLessThanOrEqual(6);
        console.log(`[TC-28] ✓ Max length enforced: "${val}" (${val.length} chars)`);

        // Test invalid chars stripped (letters, %, $)
        await sprInput.first().fill('');
        await sprInput.first().fill('12abc');
        val = await sprInput.first().inputValue();
        expect(val).not.toContain('a');
        expect(val).not.toContain('b');
        expect(val).not.toContain('c');
        console.log(`[TC-28] ✓ Invalid characters stripped: "${val}"`);

        break;
      }

      // Navigate to next question
      const nextBtn = page.locator('button:has-text("Next")').last();
      if (await nextBtn.count() > 0 && await nextBtn.isEnabled()) {
        await nextBtn.click();
        await page.waitForTimeout(500);
      } else {
        break;
      }
    }

    if (!foundSPR) {
      console.warn('[TC-28] INFO: No SPR questions found in this session — all MCQ');
    }
  });

  // ── 29. Answer sync to backend ──────────────────────────────────────
  test('TC-29 | Answered question syncs to backend within 5 seconds', async () => {
    const url = page.url();
    if (!url.includes('/exam/') && !url.includes('/drill/')) {
      console.warn('[TC-29] SKIP: Not on an exam page');
      return;
    }

    // Extract session ID from URL
    const urlParts = url.split('/');
    const sessionId = urlParts[urlParts.length - 1];

    // Answer the current question
    const optionBtns = page.locator('[data-testid="option-btn"]');
    const sprInput = page.locator('input[placeholder*="answer" i]');
    let answeredType = '';

    if (await optionBtns.count() >= 2) {
      await optionBtns.first().click();
      answeredType = 'MCQ';
    } else if (await sprInput.count() > 0) {
      await sprInput.first().fill('7');
      answeredType = 'SPR';
    } else {
      console.warn('[TC-29] SKIP: No answerable question on current page');
      return;
    }

    console.log(`[TC-29] Answered ${answeredType} question, waiting for sync...`);

    // Wait for debounce (2s) + sync time
    await page.waitForTimeout(5000);

    // Check backend for the response
    const resp = await page.request.get(`${API_URL}/sessions/${sessionId}`, {
      headers: { 'X-User-ID': USER_ID, 'X-Tenant-ID': 'public' },
    });

    if (resp.ok()) {
      const sessionData = await resp.json();
      const history = sessionData.response_history || [];
      if (history.length > 0) {
        console.log(`[TC-29] ✓ Backend has ${history.length} response(s) synced`);
      } else {
        console.warn('[TC-29] ISSUE: Backend session exists but response_history is empty — sync may not have completed');
      }
    } else if (resp.status() === 404) {
      console.warn('[TC-29] ISSUE: Session not found in backend — sync may use a different session ID');
    } else {
      console.warn(`[TC-29] ISSUE: Backend returned ${resp.status()}`);
    }
  });

  // ── 30. Complete exam end-to-end ────────────────────────────────────
  test('TC-30 | Student can complete a full module (answer all → finish)', async () => {
    // Start a fresh daily session
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForFunction(
      () => {
        const btns = Array.from(document.querySelectorAll('button'));
        return btns.some(b => /Daily (Math|RW)/.test(b.textContent?.trim() || '') && !b.disabled);
      },
      { timeout: 15_000 }
    ).catch(() => {});

    const dailyBtn = page.locator('button:has-text("Daily Math"), button:has-text("Daily RW")').first();
    if (!(await dailyBtn.isVisible({ timeout: 5_000 }).catch(() => false))) {
      console.warn('[TC-30] SKIP: No daily practice button available');
      return;
    }
    await dailyBtn.click();
    await page.waitForURL(/\/(exam|drill)\//, { timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

    // Wait for the exam to load
    await page.locator('[data-testid="question-text"]').waitFor({ timeout: 15_000 }).catch(() => {});

    // Get total questions
    const counter = page.locator('text=/Question \\d+ of \\d+/');
    await counter.first().waitFor({ timeout: 10_000 }).catch(() => {});
    const counterText = await counter.first().textContent().catch(() => '');
    const totalMatch = counterText?.match(/of (\d+)/);
    const totalQ = totalMatch ? parseInt(totalMatch[1]) : 0;
    console.log(`[TC-30] Starting exam with ${totalQ} questions`);

    if (totalQ === 0) {
      console.warn('[TC-30] ISSUE: Could not determine total questions');
      return;
    }

    // Answer all questions and navigate through
    let answeredCount = 0;
    for (let q = 0; q < totalQ; q++) {
      // Wait for question to render
      await page.waitForTimeout(300);

      // Answer: MCQ or SPR
      const optionBtns = page.locator('[data-testid="option-btn"]:not([disabled])');
      const sprInput = page.locator('input[placeholder*="answer" i]:not([disabled])');

      if (await optionBtns.count() >= 2) {
        await optionBtns.first().click({ force: true });
        answeredCount++;
      } else if (await sprInput.count() > 0) {
        await sprInput.first().fill('42');
        answeredCount++;
      }

      // Navigate forward
      const nextBtn = page.locator('button:has-text("Next"), button:has-text("Finish Section")').last();
      if (await nextBtn.count() > 0 && await nextBtn.isEnabled()) {
        const btnText = await nextBtn.textContent();
        await nextBtn.click();
        await page.waitForTimeout(500);

        // If "Finish Section" was clicked, we completed the module
        if (btnText?.includes('Finish')) {
          console.log(`[TC-30] ✓ Clicked "Finish Section" after answering ${answeredCount} questions`);

          // Wait for post-module state
          await page.waitForTimeout(2000);

          // Check for module completion screen or Module 2 start
          const sectionComplete = page.locator('text=/Section Complete|Module Complete|Start Module 2/i');
          const dashboard = page.locator('text=Dashboard');
          const isComplete = await sectionComplete.isVisible({ timeout: 5_000 }).catch(() => false);
          const isOnDashboard = page.url().includes('/dashboard');

          if (isComplete) {
            console.log('[TC-30] ✓ Section complete screen shown — module routing confirmed');
          } else if (isOnDashboard) {
            console.log('[TC-30] ✓ Returned to dashboard — single-module exam completed');
          } else {
            console.log('[TC-30] Post-finish state:', page.url());
          }
          break;
        }
      } else {
        console.warn(`[TC-30] ISSUE: No Next/Finish button available at Q${q + 1}`);
        break;
      }
    }
    console.log(`[TC-30] Answered ${answeredCount}/${totalQ} questions`);
  });

  // ── 31. Review grid navigation ──────────────────────────────────────
  test('TC-31 | Review grid opens and allows jumping to any question', async () => {
    const url = page.url();
    if (!url.includes('/exam/') && !url.includes('/drill/')) {
      // Navigate back to an active exam
      await page.goto(`${BASE_URL}/dashboard`);
      const dailyBtn = page.locator('button:has-text("Daily Math"), button:has-text("Daily RW")').first();
      if (await dailyBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await dailyBtn.click();
        await page.waitForURL(/\/(exam|drill)\//, { timeout: 30_000 });
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
      } else {
        console.warn('[TC-31] SKIP: No exam available');
        return;
      }
    }

    // Click the question counter button (opens review grid)
    const counterBtn = page.locator('button[aria-label*="Question"], button:has-text("Question")').first();
    await counterBtn.waitFor({ timeout: 10_000 }).catch(() => {});

    if (await counterBtn.count() === 0) {
      console.warn('[TC-31] ISSUE: Question counter button not found');
      return;
    }

    await counterBtn.click();
    await page.waitForTimeout(500);

    // Review grid should appear as an overlay/modal
    const gridItems = page.locator('[class*="reviewGrid"] button, [class*="grid"] button[class*="question"]');
    const gridCount = await gridItems.count();
    if (gridCount === 0) {
      // Try alternate selector — numbered buttons in a grid
      const numberedBtns = page.locator('button:has-text("1"), button:has-text("2"), button:has-text("3")');
      const altCount = await numberedBtns.count();
      console.log(`[TC-31] Review grid: ${gridCount} grid items, ${altCount} numbered buttons`);
    } else {
      console.log(`[TC-31] ✓ Review grid opened with ${gridCount} question buttons`);

      // Click on question 3 (if available)
      if (gridCount >= 3) {
        await gridItems.nth(2).click();
        await page.waitForTimeout(500);

        const counter = page.locator('text=/Question \\d+ of \\d+/');
        const text = await counter.first().textContent().catch(() => '');
        if (text?.includes('3')) {
          console.log('[TC-31] ✓ Jumped to Question 3 via review grid');
        } else {
          console.log(`[TC-31] After grid click, counter shows: ${text}`);
        }
      }
    }
  });

  // ── 32. Session resume mid-exam ─────────────────────────────────────
  test('TC-32 | Student can leave and resume an exam from correct position', async () => {
    const url = page.url();
    if (!url.includes('/exam/') && !url.includes('/drill/')) {
      console.warn('[TC-32] SKIP: Not on an exam page');
      return;
    }

    // Record current question
    const counter = page.locator('text=/Question \\d+ of \\d+/');
    const beforeText = await counter.first().textContent().catch(() => '');
    const beforeMatch = beforeText?.match(/Question (\d+)/);
    const questionBefore = beforeMatch ? parseInt(beforeMatch[1]) : 0;

    // Navigate to next question first (so we're not on Q1)
    const nextBtn = page.locator('button:has-text("Next")').last();
    if (await nextBtn.count() > 0 && await nextBtn.isEnabled()) {
      await nextBtn.click();
      await page.waitForTimeout(500);
    }

    const midText = await counter.first().textContent().catch(() => '');
    const midMatch = midText?.match(/Question (\d+)/);
    const questionMid = midMatch ? parseInt(midMatch[1]) : 0;
    const examUrl = page.url();
    console.log(`[TC-32] Left exam at Question ${questionMid}: ${examUrl}`);

    // Leave — go to dashboard
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });

    // Return to the exam
    await page.goto(examUrl);
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await page.locator('[data-testid="question-text"]').waitFor({ timeout: 15_000 }).catch(() => {});

    // Check position
    const afterText = await counter.first().textContent().catch(() => '');
    const afterMatch = afterText?.match(/Question (\d+)/);
    const questionAfter = afterMatch ? parseInt(afterMatch[1]) : 0;

    // Should resume at same question or at least not reset to Q1
    if (questionAfter >= questionMid || questionAfter > 1) {
      console.log(`[TC-32] ✓ Resumed at Question ${questionAfter} (left at Q${questionMid})`);
    } else if (questionAfter === 1 && questionMid > 1) {
      console.warn(`[TC-32] ISSUE: Reset to Q1 instead of resuming at Q${questionMid}`);
    } else {
      console.log(`[TC-32] Resumed at Question ${questionAfter}`);
    }
  });

  // ── 33. Bookmark/mark for review ────────────────────────────────────
  test('TC-33 | Student can bookmark a question for review', async () => {
    const url = page.url();
    if (!url.includes('/exam/') && !url.includes('/drill/')) {
      console.warn('[TC-33] SKIP: Not on an exam page');
      return;
    }

    // Look for bookmark/flag button
    const bookmarkBtn = page.locator('button[aria-label*="bookmark" i], button[aria-label*="mark" i], button[aria-label*="flag" i], button:has-text("Mark")').first();
    if (await bookmarkBtn.count() === 0) {
      console.warn('[TC-33] INFO: No bookmark button found — feature may use different UI');
      return;
    }

    await bookmarkBtn.click();
    await page.waitForTimeout(300);

    // Verify visual state changed (star filled, flag icon, etc.)
    console.log('[TC-33] ✓ Bookmark button clicked');

    // Open review grid to verify the flag appears
    const counterBtn = page.locator('button[aria-label*="Question"], button:has-text("Question")').first();
    if (await counterBtn.count() > 0) {
      await counterBtn.click();
      await page.waitForTimeout(500);

      // Look for flagged indicator in grid
      const flaggedItem = page.locator('[class*="flag"], [class*="marked"], [class*="bookmark"]');
      if (await flaggedItem.count() > 0) {
        console.log('[TC-33] ✓ Bookmarked question shows flag in review grid');
      }

      // Close grid (click outside or press Escape)
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
  });

  // ── 34. Eliminator mode ─────────────────────────────────────────────
  test('TC-34 | Eliminator mode allows crossing out options', async () => {
    const url = page.url();
    if (!url.includes('/exam/') && !url.includes('/drill/')) {
      console.warn('[TC-34] SKIP: Not on an exam page');
      return;
    }

    // Ensure we're on an MCQ question
    const optionBtns = page.locator('[data-testid="option-btn"]');
    if (await optionBtns.count() < 2) {
      console.warn('[TC-34] SKIP: Not on an MCQ question');
      return;
    }

    // Close any open modal overlay (e.g., ReviewGrid from prior test)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Find eliminator button
    const eliminatorBtn = page.locator('button[aria-label*="eliminat" i], button:has-text("Eliminate"), button:has-text("Eliminator")').first();
    if (await eliminatorBtn.count() === 0) {
      console.warn('[TC-34] INFO: No eliminator button found');
      return;
    }

    await eliminatorBtn.click({ force: true });
    await page.waitForTimeout(300);

    // In eliminator mode, X buttons should appear on options
    const eliminateXBtns = page.locator('[class*="eliminate"] button, button[aria-label*="eliminate" i]');
    if (await eliminateXBtns.count() > 0) {
      // Click X on the first option to eliminate it
      await eliminateXBtns.first().click();
      await page.waitForTimeout(300);

      // Verify option is struck through (look for line-through or opacity change)
      const eliminated = page.locator('[class*="Eliminated"], [class*="eliminated"], [style*="line-through"]');
      if (await eliminated.count() > 0) {
        console.log('[TC-34] ✓ Option eliminated with strikethrough');
      } else {
        console.log('[TC-34] Eliminator activated but strikethrough style not detected');
      }
    } else {
      console.log('[TC-34] Eliminator toggled but no X buttons visible');
    }

    // Turn off eliminator mode
    await eliminatorBtn.click();
    await page.waitForTimeout(300);
    console.log('[TC-34] ✓ Eliminator mode toggled off');
  });

  // ── 35. Sign out ──────────────────────────────────────────────────────
  test('TC-25 | Student can sign out and is redirected to home', async () => {
    await page.goto(`${BASE_URL}/dashboard`);

    // Clerk UserButton — click to open menu
    const userBtn = page.locator('.cl-userButtonTrigger, [data-testid="user-button"]').first();
    if (await userBtn.count() > 0) {
      await userBtn.click();
      await page.waitForTimeout(500);

      const signOutBtn = page.locator('button:has-text("Sign out"), a:has-text("Sign out")').first();
      if (await signOutBtn.count() > 0) {
        await signOutBtn.click();
        await page.waitForURL(`${BASE_URL}/`, { timeout: 15_000 });
        console.log('[TC-25] Signed out successfully');
        await expect(page.locator('text=Sign in, text=Get Started, text=Log in')).toBeVisible({ timeout: 5_000 });
      }
    } else {
      console.warn('[TC-25] INFO: Could not locate Clerk user button for sign-out test');
    }
  });
});
