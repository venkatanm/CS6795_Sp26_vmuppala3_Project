/**
 * Hook for syncing exam answers to the backend with offline tolerance.
 * 
 * Features:
 * - Tracks "dirty" answers that haven't been confirmed by server
 * - Debounces sync requests (2 seconds after last change)
 * - Retries failed syncs automatically (every 30 seconds OR when online)
 * - Handles network errors gracefully
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useOnline } from './useOnline';

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'error';

interface UseAnswerSyncOptions {
  sessionId: string;
  answers: Record<string, string>;
  session?: {
    examId?: string;
    status?: string;
    currentModuleId?: string;
    currentQuestionIndex?: number;
  };
}

export function useAnswerSync({ sessionId, answers, session }: UseAnswerSyncOptions): { syncStatus: SyncStatus } {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('synced');
  const [dirtyAnswers, setDirtyAnswers] = useState<Set<string>>(new Set());
  const isOnline = useOnline();
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const retryIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isSyncingRef = useRef(false); // Prevent infinite loops
  const lastAnswersRef = useRef<Record<string, string>>({}); // Track last synced answers
  const dirtyAnswersRef = useRef<Set<string>>(new Set()); // Track dirty answers via ref to avoid dependency loops
  
  // Debounced sync function
  const syncAnswers = useCallback(async () => {
    // Prevent concurrent syncs
    if (isSyncingRef.current) {
      return;
    }
    
    // Use ref to check dirty answers size to avoid dependency loop
    if (dirtyAnswersRef.current.size === 0) {
      setSyncStatus('synced');
      return;
    }
    
    // Don't sync if session is completed or in module transition (finishModule handles it)
    if (session?.status === 'completed' || (session?.status as string) === 'MODULE_1_COMPLETE') {
      setSyncStatus('synced');
      // Clear dirty list using functional update to avoid triggering useEffect
      setDirtyAnswers(() => new Set());
      dirtyAnswersRef.current = new Set();
      lastAnswersRef.current = { ...answers };
      return;
    }
    
    if (!isOnline) {
      setSyncStatus('offline');
      return;
    }
    
    // Validate required fields
    if (!sessionId || !session?.examId) {
      console.warn('[useAnswerSync] Missing required fields for sync:', { sessionId, examId: session?.examId });
      return;
    }
    
    // Validate answers is defined and is an object
    if (!answers || typeof answers !== 'object') {
      console.warn('[useAnswerSync] Invalid answers object:', answers);
      setSyncStatus('error');
      isSyncingRef.current = false;
      return;
    }
    
    isSyncingRef.current = true;
    setSyncStatus('syncing');
    
    try {
      // Format expected by /api/student/sync route:
      // { sessionId, session: { id, examId, answers, status, ... } }
      const sessionPayload = {
        id: sessionId,
        examId: session.examId,
        answers: answers || {}, // Send all answers, not just dirty ones (backend will handle updates)
        status: session.status || 'active',
        currentModuleId: session.currentModuleId,
        currentQuestionIndex: session.currentQuestionIndex || 0,
        updatedAt: Date.now()
      };
      
      const response = await fetch('/api/student/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionId,
          session: sessionPayload
        })
      });
      
      if (response.ok) {
        // Clear dirty list using functional update to avoid triggering useEffect
        setDirtyAnswers(() => new Set());
        dirtyAnswersRef.current = new Set();
        lastAnswersRef.current = { ...answers };
        setSyncStatus('synced');
        
        // Clear retry interval if sync succeeded
        if (retryIntervalRef.current) {
          clearInterval(retryIntervalRef.current);
          retryIntervalRef.current = null;
        }
      } else {
        // Handle 401 (unauthorized) gracefully - user might not be signed in
        if (response.status === 401) {
          console.warn('[useAnswerSync] User not authenticated - skipping sync');
          setSyncStatus('synced'); // Don't show error for auth issues
          setDirtyAnswers(() => new Set()); // Clear dirty list
          dirtyAnswersRef.current = new Set();
          lastAnswersRef.current = { ...answers }; // Update last synced to prevent retries
          return;
        }
        
        // Log response body for debugging
        let errorText = '';
        try {
          errorText = await response.text();
        } catch (e) {
          errorText = `Failed to read error response: ${e instanceof Error ? e.message : String(e)}`;
        }
        
        console.error('[useAnswerSync] Sync failed:', {
          status: response.status,
          statusText: response.statusText,
          errorText: errorText,
          sessionId: sessionId,
          examId: session?.examId,
          answerCount: Object.keys(answers || {}).length
        });
        
        setSyncStatus(isOnline ? 'error' : 'offline');
        // Keep answers in dirty list for retry (except for 401)
      }
    } catch (error) {
      console.error('[useAnswerSync] Sync error:', {
        error: error,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        sessionId: sessionId,
        examId: session?.examId,
        answerCount: Object.keys(answers || {}).length,
        isOnline: isOnline
      });
      setSyncStatus(isOnline ? 'error' : 'offline');
      // Keep answers in dirty list for retry
    } finally {
      isSyncingRef.current = false;
    }
  }, [answers, sessionId, session, isOnline]); // Removed dirtyAnswers.size to break dependency loop
  
  // Debounced sync (2 seconds after last change)
  const debouncedSync = useCallback(() => {
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }
    
    syncTimeoutRef.current = setTimeout(() => {
      syncAnswers();
    }, 2000); // 2 second debounce
  }, [syncAnswers]);
  
  // Track dirty answers when answers change
  useEffect(() => {
    // Guard against undefined/null answers
    if (!answers || typeof answers !== 'object') {
      return;
    }
    
    // Only mark as dirty if answer actually changed (not just cleared)
    const changedAnswers = new Set<string>();
    const currentKeys = Object.keys(answers);
    const lastKeys = Object.keys(lastAnswersRef.current);
    
    // Find new or changed answers
    currentKeys.forEach(qId => {
      if (answers[qId] && answers[qId] !== lastAnswersRef.current[qId]) {
        changedAnswers.add(qId);
      }
    });
    
    // Only update if there are actual changes
    if (changedAnswers.size > 0) {
      setDirtyAnswers(prevDirty => {
        const newDirty = new Set(prevDirty);
        changedAnswers.forEach(qId => newDirty.add(qId));
        dirtyAnswersRef.current = newDirty; // Update ref as well
        return newDirty;
      });
      debouncedSync();
    }
  }, [answers, debouncedSync]); // Include debouncedSync in deps
  
  // Retry logic: retry every 30 seconds if there are dirty answers
  useEffect(() => {
    // Use ref to check size to avoid dependency loop
    if (dirtyAnswersRef.current.size > 0 && (isOnline || syncStatus === 'error')) {
      // Clear any existing interval
      if (retryIntervalRef.current) {
        clearInterval(retryIntervalRef.current);
      }
      
      retryIntervalRef.current = setInterval(() => {
        syncAnswers();
      }, 30000); // Retry every 30 seconds
      
      return () => {
        if (retryIntervalRef.current) {
          clearInterval(retryIntervalRef.current);
          retryIntervalRef.current = null;
        }
      };
    }
  }, [isOnline, syncStatus, syncAnswers]); // Removed dirtyAnswers.size to break loop
  
  // Also sync when coming back online
  useEffect(() => {
    // Use ref to check size to avoid dependency loop
    if (isOnline && dirtyAnswersRef.current.size > 0) {
      syncAnswers();
    }
  }, [isOnline, syncAnswers]); // Removed dirtyAnswers.size to break loop
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
      if (retryIntervalRef.current) {
        clearInterval(retryIntervalRef.current);
      }
    };
  }, []);
  
  return { syncStatus };
}
