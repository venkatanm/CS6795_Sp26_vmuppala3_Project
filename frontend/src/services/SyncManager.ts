'use client';

import api from '@/lib/api';
import { db, SessionRecord } from '@/src/lib/db';

/**
 * SyncManager
 * 
 * Handles offline-to-online reconciliation by syncing local exam data
 * to the server when connectivity is restored.
 * 
 * This is a simplified version that provides the basic interface
 * expected by SyncManagerProvider.
 */
class SyncManager {
  private syncInProgress: boolean = false;
  private onlineListener: (() => void) | null = null;
  private visibilityListener: (() => void) | null = null;

  /**
   * Initialize the sync manager
   * Sets up listeners for online/offline events and visibility changes
   */
  initialize() {
    console.log('[SyncManager] Initializing...');

    // Listen for online events
    if (typeof window !== 'undefined') {
      this.onlineListener = () => {
        if (navigator.onLine) {
          console.log('[SyncManager] Network online, attempting sync...');
          this.sync();
        }
      };
      window.addEventListener('online', this.onlineListener);

      // Listen for visibility changes (when user returns to tab)
      this.visibilityListener = () => {
        if (!document.hidden && navigator.onLine) {
          console.log('[SyncManager] Tab visible and online, attempting sync...');
          this.sync();
        }
      };
      document.addEventListener('visibilitychange', this.visibilityListener);

      // Initial sync if online
      if (navigator.onLine) {
        setTimeout(() => {
          this.sync();
        }, 5000); // Wait 5 seconds after initialization
      }
    }
  }

  /**
   * Cleanup the sync manager
   * Removes event listeners
   */
  cleanup() {
    console.log('[SyncManager] Cleaning up...');

    if (typeof window !== 'undefined') {
      if (this.onlineListener) {
        window.removeEventListener('online', this.onlineListener);
        this.onlineListener = null;
      }

      if (this.visibilityListener) {
        document.removeEventListener('visibilitychange', this.visibilityListener);
        this.visibilityListener = null;
      }
    }
  }

  /**
   * Find active session in IndexedDB
   * Note: With module-based architecture, answer syncing is handled by useAnswerSync hook.
   * This SyncManager is for legacy/backup syncing of session metadata.
   */
  private async findActiveSession(): Promise<SessionRecord | null> {
    try {
      // Get all sessions and filter by active statuses
      // Support both 'active' and 'in_progress' statuses for compatibility
      const allSessions = await db.sessions
        .filter((s) => s.status === 'active' || (s.status as string) === 'in_progress')
        .toArray();

      // Filter for unsynced sessions
      const unsyncedSessions = allSessions.filter((s) => !s.isSynced);

      return unsyncedSessions.length > 0 ? unsyncedSessions[0] : null;
    } catch (error) {
      console.error('[SyncManager] Error finding active session:', error);
      return null;
    }
  }

  /**
   * Sync local data to server
   */
  private async sync() {
    if (this.syncInProgress) {
      console.log('[SyncManager] Sync already in progress, skipping...');
      return;
    }

    if (!navigator.onLine) {
      console.log('[SyncManager] Offline, skipping sync...');
      return;
    }

    this.syncInProgress = true;
    console.log('[SyncManager] Starting sync...');

    try {
      const activeSession = await this.findActiveSession();

      if (!activeSession) {
        // Silently skip if no active session - this is normal when no exam is in progress
        // Answer syncing is handled by useAnswerSync hook in ExamRunner
        this.syncInProgress = false;
        return;
      }

      // Note: Answer syncing is handled by useAnswerSync hook in ExamRunner
      // This SyncManager is for legacy/backup syncing of session metadata
      // TODO: Implement session metadata sync if needed
      console.log('[SyncManager] Found active session:', activeSession.id);
      
      // For now, session metadata syncing is handled by ExamContext.finishModule
      // and useAnswerSync handles answer syncing, so this is mostly a placeholder

      console.log('[SyncManager] ✅ Sync check complete');
    } catch (error: any) {
      console.error('[SyncManager] ❌ Error during sync:', error);
    } finally {
      this.syncInProgress = false;
    }
  }
}

// Export singleton instance
export const syncManager = new SyncManager();

// Export the class for testing if needed
export default SyncManager;
