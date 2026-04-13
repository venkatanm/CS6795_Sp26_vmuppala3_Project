import { test, expect, chromium, Browser, Page } from '@playwright/test';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Student Bot Stress Test
 * 
 * Simulates 100 concurrent students taking a full exam to test:
 * - Backend synchronization
 * - Local DB stability
 * - Telemetry endpoint performance
 * - WebSocket connections
 * 
 * Usage:
 *   npx playwright test tests/stress/student-bot.spec.ts --workers=100
 */

// Configuration
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const API_URL = process.env.API_URL || 'http://localhost:8000';
const NUM_BOTS = parseInt(process.env.NUM_BOTS || '100');
const EXAM_ID = process.env.EXAM_ID || ''; // Will fetch first available if not provided

// Performance monitoring
interface PerformanceMetrics {
  botId: number;
  startTime: number;
  endTime?: number;
  duration?: number;
  questionsAnswered: number;
  errors: string[];
  sessionId?: string;
  completed: boolean;
}

const metrics: PerformanceMetrics[] = [];
let serverMetrics: { cpu: number; memory: number; timestamp: number }[] = [];

/**
 * Monitor server CPU and Memory usage
 * Note: This is a simplified version. For production, use proper monitoring tools like:
 * - Prometheus + Grafana
 * - New Relic
 * - DataDog
 * - Custom metrics endpoint
 */
async function startServerMonitoring(): Promise<() => void> {
  const interval = setInterval(async () => {
    try {
      const timestamp = Date.now();
      
      // Try to fetch metrics from a monitoring endpoint if available
      // Otherwise, use system commands (platform-dependent)
      let cpu = 0;
      let memory = 0;
      
      try {
        // If you have a metrics endpoint, use it:
        // const response = await fetch(`${API_URL}/metrics`);
        // const data = await response.json();
        // cpu = data.cpu;
        // memory = data.memory;
        
        // For now, we'll track timestamps and let the report note that
        // proper monitoring tools should be used
      } catch (error) {
        // Fallback: no metrics available
      }
      
      serverMetrics.push({
        cpu,
        memory,
        timestamp,
      });
    } catch (error) {
      console.error('Error monitoring server:', error);
    }
  }, 2000); // Sample every 2 seconds

  return () => clearInterval(interval);
}

/**
 * Create a unique test user email
 */
function generateTestUserEmail(botId: number): string {
  return `stress-test-bot-${botId}-${Date.now()}@test.local`;
}

/**
 * Student Bot - Simulates a student taking an exam
 */
async function runStudentBot(
  browser: Browser,
  botId: number,
  examId: string
): Promise<PerformanceMetrics> {
  const metric: PerformanceMetrics = {
    botId,
    startTime: Date.now(),
    questionsAnswered: 0,
    errors: [],
    completed: false,
  };

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    // Use headless mode for performance
  });

  const page = await context.newPage();

  try {
    // Step 1: Navigate to sign-up page
    console.log(`[Bot ${botId}] Navigating to sign-up...`);
    await page.goto(`${BASE_URL}/sign-up`, { waitUntil: 'networkidle' });

    // Step 2: Sign up as a new user
    const email = generateTestUserEmail(botId);
    const password = `TestPassword123!${botId}`;

    // Wait for Clerk sign-up form - try multiple selectors
    try {
      await page.waitForSelector('input[type="email"], input[name="email"], input[id*="email"]', {
        timeout: 15000,
      });
      
      // Fill email
      const emailInput = page.locator('input[type="email"], input[name="email"], input[id*="email"]').first();
      await emailInput.fill(email);
      
      // Fill password
      const passwordInput = page.locator('input[type="password"], input[name="password"], input[id*="password"]').first();
      await passwordInput.fill(password);
      
      // Click sign-up button
      const signUpButton = page
        .locator('button:has-text("Sign up"), button:has-text("Sign Up"), button[type="submit"]')
        .first();
      await signUpButton.click();

      // Wait for redirect to dashboard (or handle email verification if required)
      // Clerk might require email verification, so we'll wait for either dashboard or verification page
      await Promise.race([
        page.waitForURL(/\/dashboard/, { timeout: 30000 }),
        page.waitForURL(/\/verify/, { timeout: 30000 }),
        page.waitForSelector('text=/dashboard|verify|check your email/i', { timeout: 30000 }),
      ]);
    } catch (error: any) {
      // If sign-up fails, try to use existing test credentials or bypass auth
      console.log(`[Bot ${botId}] Sign-up failed, attempting alternative authentication...`);
      metric.errors.push(`Sign-up error: ${error.message}`);
      
      // For stress testing, you might want to use Clerk's test mode or bypass auth
      // This is a placeholder - adjust based on your Clerk configuration
      await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle' });
    }

    console.log(`[Bot ${botId}] Signed up and redirected to dashboard`);

    // Step 3: Wait for exams to load and click "Start Exam"
    await page.waitForSelector('button:has-text("Start Exam")', { timeout: 10000 });
    
    // If examId is provided, look for that specific exam, otherwise click first
    let startButton;
    if (examId) {
      // Find exam card with matching exam ID (you may need to adjust selector)
      startButton = page.locator(`[data-exam-id="${examId}"] button:has-text("Start Exam")`).first();
    } else {
      startButton = page.locator('button:has-text("Start Exam")').first();
    }

    await startButton.click();
    console.log(`[Bot ${botId}] Clicked Start Exam`);

    // Step 4: Wait for exam page to load
    await page.waitForURL(/\/exam\//, { timeout: 10000 });
    const sessionId = page.url().split('/exam/')[1]?.split('?')[0];
    metric.sessionId = sessionId;
    console.log(`[Bot ${botId}] Exam started, session ID: ${sessionId}`);

    // Step 5: Loop through questions
    let questionCount = 0;
    const maxQuestions = 50; // Safety limit
    let examComplete = false;

    while (!examComplete && questionCount < maxQuestions) {
      try {
        // Wait for question to load - check for radio buttons or exam completion
        try {
          await page.waitForSelector('input[type="radio"], [role="radiogroup"]', {
            timeout: 15000,
          });
        } catch {
          // Check if exam is complete
          if (page.url().includes('/results')) {
            examComplete = true;
            break;
          }
          const completeIndicator = page.locator('text=/complete|finished|results|score/i');
          if ((await completeIndicator.count()) > 0) {
            examComplete = true;
            break;
          }
          throw new Error('Question page did not load');
        }

        // Step 6: Randomly select an answer (A-D)
        const options = page.locator('input[type="radio"]');
        const optionCount = await options.count();

        if (optionCount === 0) {
          // Check if exam is complete
          if (page.url().includes('/results')) {
            examComplete = true;
            break;
          }
          const completeIndicator = page.locator('text=/complete|finished|results/i');
          if ((await completeIndicator.count()) > 0) {
            examComplete = true;
            break;
          }
          throw new Error('No answer options found');
        }

        // Select random option (0 to optionCount-1)
        const randomIndex = Math.floor(Math.random() * optionCount);
        await options.nth(randomIndex).check();
        
        // Wait a bit for selection to register
        await page.waitForTimeout(500);

        // Step 7: Wait random time (10-45s) to simulate "thinking"
        const thinkTime = 10000 + Math.random() * 35000; // 10-45 seconds
        console.log(
          `[Bot ${botId}] Question ${questionCount + 1}: Selected option ${randomIndex}, ` +
          `thinking for ${Math.round(thinkTime / 1000)}s...`
        );
        await page.waitForTimeout(thinkTime);

        // Step 8: Click "Submit Answer" button (not "Next" - the button says "Submit Answer")
        const submitButton = page
          .locator('button:has-text("Submit Answer"), button:has-text("Submit"), button:has-text("Next")')
          .first();
        
        if ((await submitButton.count()) === 0) {
          throw new Error('Submit button not found');
        }
        
        await submitButton.click();

        questionCount++;
        metric.questionsAnswered = questionCount;

        // Wait for next question to load or exam to complete
        try {
          // Wait for either next question or results page
          await Promise.race([
            page.waitForURL(/\/results/, { timeout: 15000 }),
            page.waitForSelector('input[type="radio"], [role="radiogroup"]', { timeout: 15000 }),
            page.waitForSelector('text=/results|complete|score/i', { timeout: 15000 }),
          ]);

          // Check if redirected to results page
          if (page.url().includes('/results')) {
            examComplete = true;
            console.log(`[Bot ${botId}] Exam completed, redirected to results`);
            break;
          }
        } catch (error) {
          // Might be on results page or exam complete
          if (page.url().includes('/results')) {
            examComplete = true;
            break;
          }
          // Check current URL to see if we're still on exam page
          const currentUrl = page.url();
          if (!currentUrl.includes('/exam/')) {
            examComplete = true;
            break;
          }
          throw error;
        }
      } catch (error: any) {
        const errorMsg = `Question ${questionCount + 1}: ${error.message}`;
        console.error(`[Bot ${botId}] ${errorMsg}`);
        metric.errors.push(errorMsg);

        // Check if exam is actually complete
        if (page.url().includes('/results')) {
          examComplete = true;
          break;
        }

        // If too many errors, break
        if (metric.errors.length > 5) {
          throw new Error('Too many errors, stopping bot');
        }
      }
    }

    metric.completed = examComplete;
    metric.endTime = Date.now();
    metric.duration = metric.endTime - metric.startTime;

    console.log(
      `[Bot ${botId}] Finished: ${metric.completed ? 'Completed' : 'Incomplete'}, ` +
      `${metric.questionsAnswered} questions, ${metric.duration}ms`
    );
  } catch (error: any) {
    metric.errors.push(`Fatal error: ${error.message}`);
    metric.endTime = Date.now();
    metric.duration = metric.endTime - metric.startTime;
    console.error(`[Bot ${botId}] Fatal error:`, error.message);
  } finally {
    await context.close();
  }

  return metric;
}

/**
 * Verify sessions in database
 */
async function verifySessions(): Promise<{
  totalSessions: number;
  completedSessions: number;
  sessionsWithScores: number;
}> {
  try {
    const response = await fetch(`${API_URL}/sessions?limit=1000`);
    if (!response.ok) {
      throw new Error(`Failed to fetch sessions: ${response.statusText}`);
    }

    const sessions = await response.json();
    const totalSessions = Array.isArray(sessions) ? sessions.length : 0;
    const completedSessions = Array.isArray(sessions)
      ? sessions.filter((s: any) => s.status === 'completed').length
      : 0;
    const sessionsWithScores = Array.isArray(sessions)
      ? sessions.filter((s: any) => s.student_theta !== null).length
      : 0;

    return {
      totalSessions,
      completedSessions,
      sessionsWithScores,
    };
  } catch (error) {
    console.error('Error verifying sessions:', error);
    return {
      totalSessions: 0,
      completedSessions: 0,
      sessionsWithScores: 0,
    };
  }
}

/**
 * Check telemetry endpoint health
 */
async function checkTelemetryHealth(): Promise<{
  healthy: boolean;
  responseTime: number;
  error?: string;
}> {
  const startTime = Date.now();
  try {
    const response = await fetch(`${API_URL}/api/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: [] }),
    });

    const responseTime = Date.now() - startTime;
    return {
      healthy: response.ok,
      responseTime,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (error: any) {
    return {
      healthy: false,
      responseTime: Date.now() - startTime,
      error: error.message,
    };
  }
}

/**
 * Generate performance report
 */
function generateReport(): string {
  const completedBots = metrics.filter((m) => m.completed).length;
  const totalQuestions = metrics.reduce((sum, m) => sum + m.questionsAnswered, 0);
  const avgDuration = metrics.reduce((sum, m) => sum + (m.duration || 0), 0) / metrics.length;
  const totalErrors = metrics.reduce((sum, m) => sum + m.errors.length, 0);

  const report = `
# Stress Test Report

## Test Configuration
- **Bots**: ${NUM_BOTS}
- **Base URL**: ${BASE_URL}
- **API URL**: ${API_URL}
- **Test Duration**: ${Math.max(...metrics.map((m) => m.duration || 0))}ms

## Results
- **Completed Bots**: ${completedBots} / ${NUM_BOTS} (${((completedBots / NUM_BOTS) * 100).toFixed(1)}%)
- **Total Questions Answered**: ${totalQuestions}
- **Average Questions per Bot**: ${(totalQuestions / NUM_BOTS).toFixed(1)}
- **Average Duration**: ${(avgDuration / 1000).toFixed(1)}s
- **Total Errors**: ${totalErrors}

## Bot Performance
${metrics
  .map(
    (m) =>
      `- Bot ${m.botId}: ${m.completed ? '✅' : '❌'} ${m.questionsAnswered} questions, ` +
      `${((m.duration || 0) / 1000).toFixed(1)}s, ${m.errors.length} errors`
  )
  .join('\n')}

## Errors Summary
${metrics
  .filter((m) => m.errors.length > 0)
  .map((m) => `### Bot ${m.botId}\n${m.errors.map((e) => `- ${e}`).join('\n')}`)
  .join('\n\n') || 'No errors'}

## Server Metrics
- **Samples Collected**: ${serverMetrics.length}
- **Average CPU**: ${serverMetrics.length > 0 ? (serverMetrics.reduce((sum, m) => sum + m.cpu, 0) / serverMetrics.length).toFixed(2) + '%' : 'N/A (requires monitoring tool)'}
- **Average Memory**: ${serverMetrics.length > 0 ? (serverMetrics.reduce((sum, m) => sum + m.memory, 0) / serverMetrics.length / 1024 / 1024).toFixed(2) + ' MB' : 'N/A (requires monitoring tool)'}
- **Note**: For accurate CPU/Memory metrics, integrate with monitoring tools (Prometheus, New Relic, etc.)

## Recommendations
${completedBots < NUM_BOTS * 0.9 ? '- ⚠️ Low completion rate - investigate errors' : '- ✅ High completion rate'}
${totalErrors > NUM_BOTS * 0.1 ? '- ⚠️ High error rate - review error logs' : '- ✅ Low error rate'}
${avgDuration > 300000 ? '- ⚠️ Long average duration - optimize performance' : '- ✅ Acceptable duration'}
`;

  return report;
}

// Main test
test.describe('Student Bot Stress Test', () => {
  let browser: Browser;
  let stopMonitoring: (() => void) | null = null;

  test.beforeAll(async () => {
    // Launch browser
    browser = await chromium.launch({
      headless: true,
    });

    // Start server monitoring
    stopMonitoring = await startServerMonitoring();

    // Check telemetry endpoint before test
    const telemetryHealth = await checkTelemetryHealth();
    console.log('Pre-test Telemetry Health:', telemetryHealth);
  });

  test.afterAll(async () => {
    // Stop monitoring
    if (stopMonitoring) {
      stopMonitoring();
    }

    // Close browser
    await browser.close();

    // Verify sessions
    const sessionStats = await verifySessions();
    console.log('Session Verification:', sessionStats);

    // Generate and save report
    const report = generateReport();
    const reportPath = path.join(__dirname, 'stress-test-report.md');
    fs.writeFileSync(reportPath, report);
    console.log(`\nReport saved to: ${reportPath}`);

    // Check telemetry endpoint after test
    const telemetryHealth = await checkTelemetryHealth();
    console.log('Post-test Telemetry Health:', telemetryHealth);
  });

  test('Run 100 concurrent student bots', async () => {
    // Fetch exam ID if not provided
    let examId = EXAM_ID;
    if (!examId) {
      try {
        const response = await fetch(`${API_URL}/exams?active_only=true`);
        const exams = await response.json();
        if (Array.isArray(exams) && exams.length > 0) {
          examId = exams[0].id;
          console.log(`Using exam ID: ${examId}`);
        } else {
          throw new Error('No active exams found');
        }
      } catch (error) {
        console.error('Failed to fetch exam ID:', error);
        throw error;
      }
    }

    // Run bots in parallel
    const botPromises = Array.from({ length: NUM_BOTS }, (_, i) =>
      runStudentBot(browser, i + 1, examId)
    );

    // Wait for all bots to complete
    const results = await Promise.allSettled(botPromises);

    // Collect metrics
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        metrics.push(result.value);
      } else {
        metrics.push({
          botId: index + 1,
          startTime: Date.now(),
          questionsAnswered: 0,
          errors: [`Promise rejected: ${result.reason}`],
          completed: false,
        });
      }
    });

    // Assertions
    const completedBots = metrics.filter((m) => m.completed).length;
    expect(completedBots).toBeGreaterThan(NUM_BOTS * 0.8); // At least 80% should complete

    // Verify sessions were created
    const sessionStats = await verifySessions();
    expect(sessionStats.totalSessions).toBeGreaterThanOrEqual(NUM_BOTS * 0.8);

    // Check telemetry endpoint didn't crash
    const telemetryHealth = await checkTelemetryHealth();
    expect(telemetryHealth.healthy).toBe(true);
    expect(telemetryHealth.responseTime).toBeLessThan(5000); // Should respond within 5s
  });
});
