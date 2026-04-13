import { useEffect, useCallback } from 'react';
import { db, LogRecord } from '@/src/lib/db';
import { hashUserId } from '@/src/utils/security';

/**
 * xAPI Telemetry Event Schema
 * 
 * Based on xAPI (Experience API) specification for tracking learning experiences.
 * Used for psychometric analysis of student interactions.
 * 
 * Security: The `actor` field stores student_hash_id (hashed user ID) to prevent
 * tracing back to student names/emails without the mapping table.
 */
export interface TelemetryEvent {
  /** Student hash ID (hashed user ID) - NOT the raw user ID or PII */
  actor: string;
  
  /** Action verb describing what the student did */
  verb: 'viewed' | 'answered' | 'flagged' | 'tool_used';
  
  /** Object of the action (question ID or tool name) */
  object: string;
  
  /** Unix epoch timestamp in milliseconds */
  timestamp: number;
  
  /** Additional context about the event */
  context: {
    /** Section/Module ID where the event occurred */
    section_id?: string;
    
    /** Duration in milliseconds (e.g., time spent viewing a question) */
    duration_ms?: number;
    
    /** Additional context data */
    [key: string]: any;
  };
}

/**
 * Convert TelemetryEvent to LogRecord for IndexedDB storage
 * 
 * Security: Ensures only student_hash_id is stored, never PII
 */
function telemetryEventToLogRecord(
  event: TelemetryEvent,
  sessionId: string
): Omit<LogRecord, 'id'> {
  // Sanitize context to remove any potential PII
  const sanitizedContext = sanitizeContext(event.context);
  
  return {
    sessionId,
    eventType: event.verb,
    eventData: {
      actor: event.actor, // This should already be student_hash_id
      object: event.object,
      context: sanitizedContext,
    },
    timestamp: event.timestamp,
    isSynced: false,
  };
}

/**
 * Sanitize context data to remove PII
 */
function sanitizeContext(context: any): any {
  if (!context || typeof context !== 'object') {
    return context;
  }
  
  const sanitized: any = {};
  for (const [key, value] of Object.entries(context)) {
    const lowerKey = key.toLowerCase();
    // Skip PII fields
    if (
      lowerKey.includes('email') ||
      lowerKey.includes('name') ||
      lowerKey.includes('user') ||
      lowerKey === 'username'
    ) {
      continue;
    }
    
    // Recursively sanitize nested objects
    if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeContext(value);
    } else if (typeof value === 'string') {
      // Remove email addresses from strings
      sanitized[key] = value.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL_REMOVED]');
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Queue for pending telemetry events
 * Events are batched and written to IndexedDB during idle time
 */
class TelemetryQueue {
  private queue: TelemetryEvent[] = [];
  private sessionId: string | null = null;
  private actorHash: string | null = null;
  private writeScheduled: boolean = false;

  /**
   * Initialize queue with session ID and hashed actor
   */
  initializeWithHash(sessionId: string, actorHash: string) {
    this.sessionId = sessionId;
    this.actorHash = actorHash;
  }

  /**
   * Enqueue a telemetry event
   */
  enqueue(event: Omit<TelemetryEvent, 'actor' | 'timestamp'>) {
    if (!this.sessionId || !this.actorHash) {
      console.warn('[Telemetry] Queue not initialized, dropping event');
      return;
    }

    const fullEvent: TelemetryEvent = {
      ...event,
      actor: this.actorHash,
      timestamp: Date.now(),
    };

    this.queue.push(fullEvent);

    // Schedule write to IndexedDB during idle time
    if (!this.writeScheduled) {
      this.writeScheduled = true;
      if ('requestIdleCallback' in window) {
        requestIdleCallback(() => this.flush());
      } else {
        // Fallback for browsers without requestIdleCallback
        setTimeout(() => this.flush(), 100);
      }
    }
  }

  /**
   * Flush queued events to IndexedDB
   */
  private async flush() {
    if (this.queue.length === 0 || !this.sessionId) {
      this.writeScheduled = false;
      return;
    }

    const eventsToWrite = [...this.queue];
    this.queue = [];
    this.writeScheduled = false;

    try {
      const logRecords = eventsToWrite.map((event) =>
        telemetryEventToLogRecord(event, this.sessionId!)
      );

      await db.logs.bulkAdd(logRecords);
    } catch (error) {
      console.error('[Telemetry] Error writing events to IndexedDB:', error);
      // Re-queue events on error (they'll be retried)
      this.queue.unshift(...eventsToWrite);
    }
  }
}

// Global telemetry queue instance
const telemetryQueue = new TelemetryQueue();

/**
 * useTelemetry Hook
 * 
 * Provides a React hook for logging telemetry events.
 * 
 * Security: Automatically hashes the user ID to student_hash_id before storage.
 * PII is never stored in IndexedDB.
 * 
 * Usage:
 * ```tsx
 * 'use client';
 * 
 * const { logEvent } = useTelemetry(sessionId, userId);
 * 
 * logEvent({
 *   verb: 'viewed',
 *   object: 'question_123',
 *   context: { section_id: 'rw_module_1', duration_ms: 4500 }
 * });
 * ```
 * 
 * Note: This hook must be used in client components only.
 */
export function useTelemetry(sessionId: string, actor: string) {
  // Initialize queue when hook is called
  useEffect(() => {
    if (sessionId && actor) {
      // Hash the user ID asynchronously
      hashUserId(actor)
        .then((hashedId) => {
          telemetryQueue.initializeWithHash(sessionId, hashedId);
        })
        .catch((error) => {
          console.error('[Telemetry] Failed to hash user ID:', error);
          // Fallback: use sync hash (less secure but better than storing raw ID)
          const { hashUserIdSync } = require('@/src/utils/security');
          const hashedId = hashUserIdSync(actor);
          telemetryQueue.initializeWithHash(sessionId, hashedId);
        });
    }
  }, [sessionId, actor]);

  /**
   * Log a telemetry event
   * 
   * Events are queued and written to IndexedDB during idle time
   * to avoid blocking UI rendering.
   */
  const logEvent = useCallback(
    (event: Omit<TelemetryEvent, 'actor' | 'timestamp'>) => {
      telemetryQueue.enqueue(event);
    },
    []
  );

  return {
    logEvent,
  };
}

/**
 * Get unsynced telemetry events from IndexedDB
 * 
 * @param limit Maximum number of events to return
 * @returns Array of unsynced LogRecord objects
 */
export async function getUnsyncedEvents(limit: number = 50): Promise<LogRecord[]> {
  try {
    // Use filter instead of where().equals() to handle null/undefined values safely
    const allEvents = await db.logs
      .limit(limit * 2) // Get more to filter
      .toArray();
    
    // Filter for unsynced events (isSynced === false or null/undefined)
    const unsyncedEvents = allEvents
      .filter(event => event.isSynced === false || event.isSynced == null)
      .slice(0, limit);
    
    return unsyncedEvents;
  } catch (error) {
    console.error('[Telemetry] Error fetching unsynced events:', error);
    return [];
  }
}

/**
 * Delete synced events from IndexedDB
 * 
 * @param eventIds Array of event IDs to delete
 */
export async function deleteSyncedEvents(eventIds: number[]): Promise<void> {
  try {
    if (eventIds.length === 0) {
      return;
    }

    // Delete events by ID
    await db.logs.bulkDelete(eventIds);
    
    console.log(`[Telemetry] Deleted ${eventIds.length} synced events from IndexedDB`);
  } catch (error) {
    console.error('[Telemetry] Error deleting synced events:', error);
    throw error;
  }
}

// Re-export LogRecord type for convenience
export type { LogRecord } from '@/src/lib/db';
