/**
 * Utility function to clear diagnostic sessions from IndexedDB
 * 
 * This is useful when backend sessions have been deleted but frontend
 * still has cached sessions in IndexedDB.
 * 
 * Usage:
 *   import { clearDiagnosticSessions } from '@/src/utils/clearDiagnosticSessions';
 *   await clearDiagnosticSessions('DIAGNOSTIC_MATH'); // or 'DIAGNOSTIC_RW'
 */

import { db } from '@/src/lib/db';

// Diagnostic exam UUIDs (must match backend)
const DIAGNOSTIC_MATH_UUID = '550e8400-e29b-41d4-a716-446655440000';
const DIAGNOSTIC_RW_UUID = '550e8400-e29b-41d4-a716-446655440001';

export async function clearDiagnosticSessions(
  examType: 'DIAGNOSTIC_MATH' | 'DIAGNOSTIC_RW' | 'BOTH' = 'BOTH'
): Promise<{ deleted: number; examType: string }> {
  const examIds: string[] = [];
  
  if (examType === 'DIAGNOSTIC_MATH' || examType === 'BOTH') {
    examIds.push(DIAGNOSTIC_MATH_UUID);
  }
  if (examType === 'DIAGNOSTIC_RW' || examType === 'BOTH') {
    examIds.push(DIAGNOSTIC_RW_UUID);
  }

  // Find all sessions matching the diagnostic exam IDs
  const sessionsToDelete = await db.sessions
    .where('examId')
    .anyOf(examIds)
    .toArray();

  // Delete all matching sessions
  const sessionIds = sessionsToDelete.map(s => s.id);
  await db.sessions.bulkDelete(sessionIds);

  console.log(`[clearDiagnosticSessions] Deleted ${sessionIds.length} session(s) from IndexedDB`);
  console.log(`[clearDiagnosticSessions] Session IDs: ${sessionIds.join(', ')}`);

  return {
    deleted: sessionIds.length,
    examType: examType
  };
}
