import { db, SessionRecord } from '@/src/lib/db';

/**
 * Database Health Check
 * 
 * Tests the IndexedDB connection by performing:
 * 1. Write: Adds a test record to the sessions table
 * 2. Read: Queries the table for the test record
 * 3. Verify: Checks if the returned object matches the written object
 * 4. Clean Up: Deletes the test record
 * 
 * @returns Promise<string> - "✅ DB IS HEALTHY" on success
 * @throws Error if any step fails
 */
export async function runDbHealthCheck(): Promise<string> {
  const testId = 'health-check';
  const testRecord: SessionRecord = {
    id: testId,
    examId: 'test',
    isSynced: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'active',
  };

  try {
    // Step 1: Write - Add test record to sessions table
    await db.sessions.add(testRecord);
    console.log('[DB Health Check] ✅ Write: Test record added');

    // Step 2: Read - Query the table for the test record
    const retrievedRecord = await db.sessions.get(testId);
    if (!retrievedRecord) {
      throw new Error('❌ DB IS UNHEALTHY: Failed to read test record');
    }
    console.log('[DB Health Check] ✅ Read: Test record retrieved');

    // Step 3: Verify - Check if the returned object matches the written object
    const fieldsMatch = 
      retrievedRecord.id === testRecord.id &&
      retrievedRecord.examId === testRecord.examId &&
      retrievedRecord.isSynced === testRecord.isSynced &&
      retrievedRecord.status === testRecord.status &&
      retrievedRecord.createdAt === testRecord.createdAt &&
      retrievedRecord.updatedAt === testRecord.updatedAt;

    if (!fieldsMatch) {
      throw new Error(
        `❌ DB IS UNHEALTHY: Retrieved record does not match written record.\n` +
        `Expected: ${JSON.stringify(testRecord)}\n` +
        `Got: ${JSON.stringify(retrievedRecord)}`
      );
    }
    console.log('[DB Health Check] ✅ Verify: Record matches expected values');

    // Step 4: Clean Up - Delete the test record
    await db.sessions.delete(testId);
    console.log('[DB Health Check] ✅ Clean Up: Test record deleted');

    // Step 5: Logging - Return success message
    return '✅ DB IS HEALTHY';
  } catch (error) {
    // Ensure cleanup even if an error occurs
    try {
      await db.sessions.delete(testId);
      console.log('[DB Health Check] 🧹 Clean Up: Test record deleted (error recovery)');
    } catch (cleanupError) {
      console.error('[DB Health Check] ⚠️ Failed to clean up test record:', cleanupError);
    }

    // Re-throw the original error with health check context
    if (error instanceof Error) {
      throw new Error(`❌ DB IS UNHEALTHY: ${error.message}`);
    }
    throw new Error(`❌ DB IS UNHEALTHY: ${String(error)}`);
  }
}
