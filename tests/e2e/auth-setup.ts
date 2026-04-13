/**
 * Auth Setup Script — run once to capture Clerk session state.
 *
 * Usage:
 *   BASE_URL=http://localhost:3002 npx playwright test tests/e2e/auth-setup.ts --headed
 *
 * This opens a browser, lets you sign in manually (handles device verification),
 * then saves the session cookies to auth-state.json so all E2E tests can reuse it.
 */

import { test as setup } from '@playwright/test';
import path from 'path';

const AUTH_STATE_PATH = path.join(__dirname, 'auth-state.json');
const BASE_URL = process.env.BASE_URL || 'http://localhost:3002';

setup('Save auth state after manual sign-in', async ({ page }) => {
  await page.goto(`${BASE_URL}/sign-in`);

  // Pause so you can sign in manually (handles device verification, OTP, etc.)
  console.log('\n\n========================================');
  console.log('Please sign in manually in the browser.');
  console.log('After reaching the dashboard, press Resume in the Playwright inspector.');
  console.log('========================================\n\n');

  await page.pause(); // pauses until you click Resume in Playwright inspector

  // Wait to be on the dashboard
  await page.waitForURL(`${BASE_URL}/dashboard`, { timeout: 120_000 });

  // Save the auth state (cookies + localStorage)
  await page.context().storageState({ path: AUTH_STATE_PATH });
  console.log(`\n✅ Auth state saved to: ${AUTH_STATE_PATH}`);
});
