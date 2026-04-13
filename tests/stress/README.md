# Student Bot Stress Test

## Overview

This stress test simulates 100 concurrent students taking a full exam to validate:
- Backend synchronization under load
- Local DB (IndexedDB) stability
- Telemetry endpoint performance
- WebSocket connection handling
- Database session creation and scoring

## Prerequisites

1. **Install Playwright:**
   ```bash
   npm install -D @playwright/test
   npx playwright install
   ```

2. **Environment Setup:**
   - Frontend server running on `http://localhost:3000`
   - Backend API running on `http://localhost:8000`
   - At least one active exam in the database

3. **Clerk Configuration:**
   - For stress testing, you may want to:
     - Use Clerk's test mode
     - Create test users programmatically
     - Or configure Clerk to allow test sign-ups without email verification

## Running the Test

### Basic Run (100 bots)
```bash
npx playwright test tests/stress/student-bot.spec.ts --workers=100
```

### Custom Configuration
```bash
# Run with 50 bots
NUM_BOTS=50 npx playwright test tests/stress/student-bot.spec.ts --workers=50

# Specify exam ID
EXAM_ID=<exam-uuid> npx playwright test tests/stress/student-bot.spec.ts

# Custom base URL
BASE_URL=http://localhost:3000 API_URL=http://localhost:8000 npx playwright test tests/stress/student-bot.spec.ts
```

### With Report Generation
```bash
npx playwright test tests/stress/student-bot.spec.ts --workers=100 --reporter=html
```

## Test Flow

1. **Authentication:**
   - Each bot signs up as a unique user
   - Uses email: `stress-test-bot-{id}-{timestamp}@test.local`
   - Password: `TestPassword123!{id}`

2. **Exam Start:**
   - Navigates to dashboard
   - Clicks "Start Exam" on the first available exam
   - Waits for exam page to load

3. **Question Loop:**
   - For each question:
     - Waits for question to load
     - Randomly selects an answer (A-D)
     - Waits random time (10-45 seconds) to simulate thinking
     - Clicks "Submit Answer"
     - Waits for next question or completion

4. **Completion:**
   - Detects when exam is complete
   - Records metrics and session ID

## Monitoring

The test monitors:
- **Telemetry Endpoint:** Checks `/api/telemetry` health before and after test
- **Session Creation:** Verifies sessions were created in database
- **Completion Rate:** Tracks how many bots successfully complete the exam
- **Error Rate:** Logs all errors encountered during test

## Report

After the test completes, a report is generated at:
```
tests/stress/stress-test-report.md
```

The report includes:
- Test configuration
- Completion statistics
- Bot performance breakdown
- Error summary
- Server metrics (if available)
- Recommendations

## Validation

The test validates:
- ✅ At least 80% of bots complete the exam
- ✅ At least 80% of sessions are created in database
- ✅ Telemetry endpoint remains healthy
- ✅ Telemetry endpoint responds within 5 seconds

## Troubleshooting

### Clerk Authentication Issues

If sign-up fails:
1. Check Clerk configuration allows test sign-ups
2. Consider using Clerk's test mode for stress testing
3. Or create test users programmatically before running the test

### Timeout Issues

If bots timeout:
1. Increase timeout values in the test
2. Check server performance
3. Reduce number of concurrent bots

### Database Issues

If sessions aren't created:
1. Check database connection
2. Verify API endpoints are accessible
3. Check server logs for errors

## Performance Considerations

- **Headless Mode:** Bots run in headless mode for performance
- **Parallel Execution:** Uses Playwright's parallel execution
- **Resource Usage:** Monitor server CPU/Memory during test
- **Network:** Ensure sufficient bandwidth for 100 concurrent connections

## Next Steps

For production-grade stress testing:
1. Integrate with monitoring tools (Prometheus, Grafana)
2. Add WebSocket connection monitoring
3. Implement distributed testing across multiple machines
4. Add database query performance monitoring
5. Track IndexedDB performance metrics
