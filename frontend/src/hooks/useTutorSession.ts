/**
 * useTutorSession Hook
 * 
 * Manages the AI Tutor chat session for a specific question.
 * Handles:
 * - Initializing session with question context
 * - Streaming responses from backend
 * - Saving chat history to IndexedDB
 * - Managing conversation state
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { db, TutorChatRecord } from '@/src/lib/db';
import api from '@/lib/api';
import { ThinkingState } from '@/src/components/chat/ThinkingIndicator';
import { CurrentQuestion } from '@/src/components/tutor/ChatPanel';

export interface ChatMessage {
  role: 'student' | 'tutor';
  content: string;
  timestamp: number;
}

export interface TutorSessionState {
  /** Array of chat messages */
  messages: ChatMessage[];
  /** Whether a message is currently being streamed */
  isStreaming: boolean;
  /** Error message if any */
  error: string | null;
  /** Whether session is initialized */
  isInitialized: boolean;
}

export interface UseTutorSessionReturn {
  /** Current session state */
  state: TutorSessionState;
  /** Current thinking state for UI indicator */
  thinkingState: ThinkingState;
  /** Send a message to the tutor */
  sendMessage: (message: string, image?: string) => Promise<void>;
  /** Initialize session with question context */
  initializeSession: (questionId: string, sessionId: string, studentAnswer?: string | number) => Promise<void>;
  /** Load existing chat history */
  loadHistory: (questionId: string, sessionId: string) => Promise<void>;
  /** Clear current session */
  clearSession: () => void;
}

/**
 * Hook for managing AI Tutor chat sessions
 */
export function useTutorSession(currentQuestion?: CurrentQuestion): UseTutorSessionReturn {
  const [state, setState] = useState<TutorSessionState>({
    messages: [],
    isStreaming: false,
    error: null,
    isInitialized: false,
  });

  const currentQuestionIdRef = useRef<string | null>(null);
  const currentSessionIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamingMessageRef = useRef<string>('');
  const [thinkingState, setThinkingState] = useState<ThinkingState>('idle');

  /**
   * Load chat history from IndexedDB
   */
  const loadHistory = useCallback(async (questionId: string, sessionId: string) => {
    try {
      const chatRecord = await db.tutorChats.get([questionId, sessionId]);
      
      if (chatRecord) {
        setState(prev => ({
          ...prev,
          messages: chatRecord.messages,
          isInitialized: true,
        }));
        currentQuestionIdRef.current = questionId;
        currentSessionIdRef.current = sessionId;
      } else {
        // No existing history
        setState(prev => ({
          ...prev,
          messages: [],
          isInitialized: false,
        }));
      }
    } catch (error) {
      console.error('[useTutorSession] Error loading history:', error);
      setState(prev => ({
        ...prev,
        error: 'Failed to load chat history',
      }));
    }
  }, []);

  /**
   * Save chat history to IndexedDB
   */
  const saveHistory = useCallback(async (messages: ChatMessage[]) => {
    const questionId = currentQuestionIdRef.current;
    const sessionId = currentSessionIdRef.current;

    if (!questionId || !sessionId) {
      return;
    }

    try {
      const now = Date.now();
      const existingRecord = await db.tutorChats.get([questionId, sessionId]);

      if (existingRecord) {
        // Update existing record
        await db.tutorChats.update([questionId, sessionId], {
          messages,
          updatedAt: now,
        });
      } else {
        // Create new record
        await db.tutorChats.add({
          questionId,
          sessionId,
          messages,
          createdAt: now,
          updatedAt: now,
        });
      }
    } catch (error) {
      console.error('[useTutorSession] Error saving history:', error);
    }
  }, []);

  /**
   * Initialize session with question context
   */
  const initializeSession = useCallback(async (
    questionId: string,
    sessionId: string,
    studentAnswer?: string | number
  ) => {
    currentQuestionIdRef.current = questionId;
    currentSessionIdRef.current = sessionId;

    // Try to load existing history first
    await loadHistory(questionId, sessionId);

    // If no history exists, initialize with backend
    if (state.messages.length === 0) {
      try {
        setState(prev => ({ ...prev, error: null, isInitialized: false }));

        // Initialize session on backend
        // Use relative path for Next.js API route
        const response = await fetch('/api/tutor/initialize', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            questionId,
            sessionId,
            studentAnswer,
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const responseData = await response.json();

        // Backend should return initial tutor message or empty
        if (responseData.initialMessage) {
          const initialMessage: ChatMessage = {
            role: 'tutor',
            content: responseData.initialMessage,
            timestamp: Date.now(),
          };

          setState(prev => ({
            ...prev,
            messages: [initialMessage],
            isInitialized: true,
          }));

          // Save to IndexedDB
          await saveHistory([initialMessage]);
        } else {
          setState(prev => ({
            ...prev,
            isInitialized: true,
          }));
        }
      } catch (error: any) {
        console.error('[useTutorSession] Error initializing session:', error);
        setState(prev => ({
          ...prev,
          error: error.response?.data?.detail || 'Failed to initialize tutor session',
          isInitialized: true, // Still mark as initialized to allow manual messages
        }));
      }
    }
  }, [loadHistory, saveHistory, state.messages.length]);

  /**
   * Send a message to the tutor and stream the response
   */
  const sendMessage = useCallback(async (message: string, image?: string) => {
    const questionId = currentQuestionIdRef.current;
    const sessionId = currentSessionIdRef.current;

    if (!questionId || !sessionId) {
      setState(prev => ({
        ...prev,
        error: 'Session not initialized. Please initialize the session first.',
      }));
      return;
    }

    // Cancel any ongoing stream
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // Add student message to state
    const studentMessage: ChatMessage = {
      role: 'student',
      content: message,
      timestamp: Date.now(),
    };

    setState(prev => ({
      ...prev,
      messages: [...prev.messages, studentMessage],
      isStreaming: true,
      error: null,
    }));
    
    // Set initial thinking state
    setThinkingState('analyzing');

    // Save student message immediately
    const updatedMessages = [...state.messages, studentMessage];
    await saveHistory(updatedMessages);

    try {
      // Build context object from currentQuestion if available
      const context = currentQuestion ? {
        question_id: currentQuestion.id,
        question_text: currentQuestion.text,
        skill: Array.isArray(currentQuestion.skillTags) 
          ? currentQuestion.skillTags[0] 
          : currentQuestion.skillTags || '',
      } : undefined;

      // Stream response from backend
      // Use relative path for Next.js API route
      const response = await fetch('/api/tutor/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': 'school_A', // Match api interceptor
        },
        body: JSON.stringify({
          questionId,
          sessionId,
          message,
          conversationHistory: state.messages.slice(-5), // Last 5 messages for context
          ...(image && { image }), // Include image if provided
          studentScore: 500, // Default score, can be enhanced later
          isReviewMode: true, // Assume review mode for now - can be passed as prop later
          ...(context && { context }), // Include context if available
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      if (!response.body) {
        throw new Error('Response body is null');
      }

      // Reset streaming message
      streamingMessageRef.current = '';

      // Read stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        if (abortController.signal.aborted) {
          break;
        }

        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        // Decode chunk
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6); // Remove 'data: ' prefix

            if (data === '[DONE]') {
              // Stream complete
              break;
            }

            try {
              const parsed = JSON.parse(data);
              
              // Handle status updates
              if (parsed.status) {
                const statusMap: Record<string, ThinkingState> = {
                  'analyzing': 'analyzing',
                  'generating': 'generating',
                  'reviewing': 'reviewing',
                  'checking': 'checking',
                  'updating': 'updating',
                  'complete': 'idle',
                };
                setThinkingState(statusMap[parsed.status] || 'generating');
                continue;
              }
              
              if (parsed.content) {
                // Update thinking state to generating when content starts
                if (streamingMessageRef.current === '') {
                  setThinkingState('generating');
                }
                
                // Append to streaming message
                streamingMessageRef.current += parsed.content;

                // Update state with current streaming content
                setState(prev => {
                  const tutorMessage: ChatMessage = {
                    role: 'tutor',
                    content: streamingMessageRef.current,
                    timestamp: Date.now(),
                  };

                  // Check if last message is a streaming tutor message
                  const lastMessage = prev.messages[prev.messages.length - 1];
                  if (lastMessage?.role === 'tutor') {
                    // Update existing streaming message
                    return {
                      ...prev,
                      messages: [...prev.messages.slice(0, -1), tutorMessage],
                    };
                  } else {
                    // Add new message
                    return {
                      ...prev,
                      messages: [...prev.messages, tutorMessage],
                    };
                  }
                });
              }
            } catch (e) {
              // Skip invalid JSON
              console.warn('[useTutorSession] Invalid JSON in stream:', data);
            }
          }
        }
      }

      // Stream complete - save final message
      const finalTutorMessage: ChatMessage = {
        role: 'tutor',
        content: streamingMessageRef.current,
        timestamp: Date.now(),
      };

      setState(prev => {
        const finalMessages = [...prev.messages];
        // Replace the last message (streaming) with final message
        if (finalMessages[finalMessages.length - 1]?.role === 'tutor') {
          finalMessages[finalMessages.length - 1] = finalTutorMessage;
        } else {
          finalMessages.push(finalTutorMessage);
        }

        // Save to IndexedDB
        saveHistory(finalMessages).catch(err => {
          console.error('[useTutorSession] Error saving final message:', err);
        });

        return {
          ...prev,
          messages: finalMessages,
          isStreaming: false,
        };
      });
      
      // Reset thinking state
      setThinkingState('idle');

    } catch (error: any) {
      if (error.name === 'AbortError') {
        // Stream was cancelled, ignore
        return;
      }

      console.error('[useTutorSession] Error sending message:', error);
      setState(prev => ({
        ...prev,
        isStreaming: false,
        error: error.message || 'Failed to send message',
      }));
    }
  }, [state.messages, saveHistory]);

  /**
   * Clear current session
   */
  const clearSession = useCallback(() => {
    // Cancel any ongoing stream
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    currentQuestionIdRef.current = null;
    currentSessionIdRef.current = null;
    streamingMessageRef.current = '';

    setState({
      messages: [],
      isStreaming: false,
      error: null,
      isInitialized: false,
    });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    state,
    thinkingState,
    sendMessage,
    initializeSession,
    loadHistory,
    clearSession,
  };
}
