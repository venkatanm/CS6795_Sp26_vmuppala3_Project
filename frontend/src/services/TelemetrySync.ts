import api from '@/lib/api';
import { getUnsyncedEvents, deleteSyncedEvents, LogRecord } from '@/src/lib/telemetry';
import { TelemetryEvent } from '@/src/lib/telemetry';
import { sanitizeData } from '@/src/utils/security';

/**
 * TelemetrySyncService
 * 
 * Periodically syncs telemetry events from IndexedDB to the backend API.
 * 
 * Strategy:
 * - Runs every 60 seconds
 * - Reads unsynced logs from IndexedDB (max 50 events per batch)
 * - POSTs to /api/telemetry endpoint
 * - Deletes synced events from IndexedDB on success
 */
class TelemetrySyncService {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private syncInProgress: boolean = false;

  /**
   * Start the sync service
   */
  start() {
    if (this.isRunning) {
      console.warn('[TelemetrySync] Service already running');
      return;
    }

    this.isRunning = true;
    console.log('[TelemetrySync] Service started');

    // Perform initial sync after 10 seconds (give app time to load)
    setTimeout(() => {
      this.sync();
    }, 10000);

    // Then sync every 60 seconds
    this.intervalId = setInterval(() => {
      this.sync();
    }, 60000);
  }

  /**
   * Stop the sync service
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    console.log('[TelemetrySync] Service stopped');
  }

  /**
   * Perform a sync operation
   */
  private async sync() {
    if (this.syncInProgress) {
      console.log('[TelemetrySync] Sync already in progress, skipping...');
      return;
    }

    this.syncInProgress = true;

    try {
      // Get unsynced events (max 50 per batch)
      const unsyncedEvents = await getUnsyncedEvents(50);

      if (unsyncedEvents.length === 0) {
        console.log('[TelemetrySync] No unsynced events to sync');
        this.syncInProgress = false;
        return;
      }

      console.log(`[TelemetrySync] Syncing ${unsyncedEvents.length} events...`);

      // Convert LogRecord to TelemetryEvent format for API
      const telemetryEvents = this.convertLogRecordsToTelemetryEvents(unsyncedEvents);

      // POST to backend API
      const response = await api.post('/api/telemetry', {
        events: telemetryEvents,
      });

      if (response.status === 200) {
        // Extract event IDs to delete
        const eventIds = unsyncedEvents
          .map((event) => event.id)
          .filter((id): id is number => id !== undefined);

        // Delete synced events from IndexedDB
        await deleteSyncedEvents(eventIds);

        console.log(
          `[TelemetrySync] ✅ Successfully synced ${unsyncedEvents.length} events`
        );
      } else {
        console.warn(
          `[TelemetrySync] ⚠️ Unexpected response status: ${response.status}`
        );
      }
    } catch (error: any) {
      // Don't throw - we'll retry on the next interval
      console.error('[TelemetrySync] ❌ Error syncing events:', error);

      // If it's a network error, events will be retried later
      // If it's a server error (5xx), we might want to back off
      if (error.response?.status >= 500) {
        console.warn('[TelemetrySync] Server error, will retry on next interval');
      }
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Convert LogRecord from IndexedDB to TelemetryEvent format for API
   * 
   * Security: Ensures no PII is sent to the server. The actor field
   * should already be student_hash_id (not raw user ID or PII).
   */
  private convertLogRecordsToTelemetryEvents(
    logRecords: LogRecord[]
  ): TelemetryEvent[] {
    return logRecords.map((record) => {
      const eventData = record.eventData || {};
      
      // Sanitize context to ensure no PII is sent
      const sanitizedContext = sanitizeData(eventData.context || {});
      
      return {
        actor: eventData.actor || '', // Should already be student_hash_id
        verb: record.eventType as TelemetryEvent['verb'],
        object: eventData.object || '',
        timestamp: record.timestamp,
        context: sanitizedContext,
      };
    });
  }

  /**
   * Manually trigger a sync (useful for testing or immediate sync)
   */
  async syncNow(): Promise<void> {
    await this.sync();
  }

  /**
   * Get sync status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      syncInProgress: this.syncInProgress,
    };
  }
}

// Export singleton instance
export const telemetrySyncService = new TelemetrySyncService();

// Export the class for testing if needed
export default TelemetrySyncService;
