/**
 * Utility to manually sync a session to the backend
 */
import { db } from '../lib/db';

export async function syncSessionToBackend(sessionId: string): Promise<boolean> {
  try {
    const session = await db.sessions.get(sessionId);
    if (!session) {
      console.error(`[syncSession] Session ${sessionId} not found in IndexedDB`);
      return false;
    }

    console.log(`[syncSession] 🔄 Syncing session ${sessionId} to backend...`);
    console.log(`   - Status: ${session.status}`);
    console.log(`   - Exam ID: ${session.examId}`);
    console.log(`   - Answer count: ${Object.keys(session.answers || {}).length}`);

    const response = await fetch('/api/student/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: session.id,
        session: {
          id: session.id,
          examId: session.examId,
          currentModuleId: session.currentModuleId,
          currentQuestionIndex: session.currentQuestionIndex,
          status: session.status,
          answers: session.answers,
          finalScore: session.finalScore,
          performanceProfile: session.performanceProfile,
          updatedAt: session.updatedAt || Date.now()
        }
      })
    });

    if (response.ok) {
      await db.sessions.update(sessionId, {
        isSynced: true,
        updatedAt: Date.now()
      });
      console.log(`[syncSession] ✅ Sync successful`);
      return true;
    } else {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      console.error(`[syncSession] ❌ Sync failed:`, errorData);
      return false;
    }
  } catch (error) {
    console.error(`[syncSession] ❌ Error syncing session:`, error);
    return false;
  }
}
