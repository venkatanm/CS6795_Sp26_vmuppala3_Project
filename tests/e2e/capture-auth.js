/**
 * Run this script to capture Clerk auth cookies after manual sign-in.
 *
 * Usage:
 *   node tests/e2e/capture-auth.js
 *
 * A browser window will open at the sign-in page.
 * Sign in manually, reach the dashboard, then create the trigger file:
 *   echo done > tests/e2e/.auth-ready
 */

const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3002';
const AUTH_STATE_PATH = path.join(__dirname, 'auth-state.json');
const TRIGGER_FILE = path.join(__dirname, '.auth-ready');

async function waitForTrigger(page) {
  console.log('\n========================================');
  console.log('Browser opened at:', BASE_URL + '/sign-in');
  console.log('');
  console.log('1. Sign in with your account');
  console.log('2. Complete any verification steps');
  console.log('3. Once on the dashboard, run this in another terminal:');
  console.log('');
  console.log('   echo done > tests/e2e/.auth-ready');
  console.log('');
  console.log('Waiting for trigger file...');
  console.log('========================================\n');

  // Remove stale trigger if exists
  if (fs.existsSync(TRIGGER_FILE)) fs.unlinkSync(TRIGGER_FILE);

  // Poll for the trigger file
  while (!fs.existsSync(TRIGGER_FILE)) {
    await new Promise(r => setTimeout(r, 1000));
    process.stdout.write('.');
  }
  console.log('\nTrigger received!');
}

async function main() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: false, slowMo: 0 });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/sign-in`);

  await waitForTrigger(page);

  const url = page.url();
  if (!url.includes('/dashboard')) {
    console.error(`\n❌ Not on dashboard — current URL: ${url}`);
    console.error('Navigate to the dashboard first, then re-create the trigger file.');
    await browser.close();
    process.exit(1);
  }

  await context.storageState({ path: AUTH_STATE_PATH });
  console.log(`\n✅ Auth state saved to: ${AUTH_STATE_PATH}`);
  console.log('You can now run: npm run test:e2e\n');

  // Clean up trigger
  if (fs.existsSync(TRIGGER_FILE)) fs.unlinkSync(TRIGGER_FILE);

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
