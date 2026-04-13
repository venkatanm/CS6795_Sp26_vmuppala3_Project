'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTutorSession } from '@/src/hooks/useTutorSession';
import ThinkingIndicator, { ThinkingState } from '@/src/components/chat/ThinkingIndicator';
import MathText from '@/components/exam/MathText';

export interface ReviewQuestionViewProps {
  /** Question ID */
  id: string;
  /** Session ID */
  sessionId: string;
  /** Student's score */
  score: number;
  /** Whether the answer is correct */
  isCorrect: boolean;
  /** Student's selected answer */
  studentAnswer: string | number;
  /** Static explanation text from DB */
  solutionText?: string | null;
  /** Question text */
  questionText?: string;
  /** Initial message to send to tutor (optional) */
  initialMessage?: string;
}

/**
 * ReviewQuestionView Component
 * 
 * Displays a question in review mode with conditional Socratic Chat integration.
 * 
 * Logic:
 * - If correct: Show static explanation (Green Badge)
 * - If incorrect AND not showing static: Show TutorChat with initial message
 * - If incorrect AND showing static: Show static explanation
 * 
 * UX Goal: Force engagement with AI for at least one turn before showing answer key.
 */
export default function ReviewQuestionView({
  id,
  sessionId,
  score,
  isCorrect,
  studentAnswer,
  solutionText,
  questionText,
  initialMessage,
}: ReviewQuestionViewProps) {
  const [showStaticExplanation, setShowStaticExplanation] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    state,
    sendMessage,
    initializeSession,
    clearSession,
    thinkingState,
  } = useTutorSession();

  // Initialize session when component mounts (for incorrect answers)
  useEffect(() => {
    if (!isCorrect && !showStaticExplanation && id && sessionId) {
      initializeSession(id, sessionId, studentAnswer);
    }

    return () => {
      if (!isCorrect) {
        clearSession();
      }
    };
  }, [isCorrect, showStaticExplanation, id, sessionId, studentAnswer, initializeSession, clearSession]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [state.messages, state.isStreaming]);

  // Send initial message on mount if incorrect
  useEffect(() => {
    if (!isCorrect && !showStaticExplanation && state.isInitialized && state.messages.length === 0) {
      // Use provided initialMessage or default
      const messageToSend = initialMessage || `I see you picked ${studentAnswer}. Walk me through your logic.`;
      sendMessage(messageToSend).catch(console.error);
    }
  }, [isCorrect, showStaticExplanation, state.isInitialized, state.messages.length, studentAnswer, initialMessage, sendMessage]);

  const handleSend = useCallback(async () => {
    if (!inputValue.trim() || state.isStreaming) return;

    const message = inputValue.trim();
    setInputValue('');

    try {
      await sendMessage(message);
    } catch (error) {
      console.error('Error sending message:', error);
    }
  }, [inputValue, state.isStreaming, sendMessage]);

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Render static explanation for correct answers
  if (isCorrect && solutionText) {
    return (
      <div className="border-t border-zinc-200 dark:border-zinc-700 pt-4 mt-4">
        <div className="p-4 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-semibold text-green-700 dark:text-green-400">
              ✓ Correct Answer
            </span>
          </div>
          <div className="text-sm text-zinc-900 dark:text-white whitespace-pre-line">
            <MathText>{solutionText}</MathText>
          </div>
        </div>
      </div>
    );
  }

  // Render TutorChat for incorrect answers (if not showing static)
  if (!isCorrect && !showStaticExplanation) {
    return (
      <div className="border-t border-zinc-200 dark:border-zinc-700 pt-4 mt-4">
        <div className="space-y-4">
          {/* Chat Header */}
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              AI Tutor - Let's work through this together
            </h3>
            {thinkingState !== 'idle' && (
              <ThinkingIndicator state={thinkingState} />
            )}
          </div>

          {/* Messages Container */}
          <div className="min-h-[200px] max-h-[400px] overflow-y-auto p-4 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700">
            {state.messages.length === 0 && !state.isStreaming ? (
              <div className="text-sm text-zinc-500 dark:text-zinc-400 text-center py-8">
                Starting conversation...
              </div>
            ) : (
              <div className="space-y-4">
                {state.messages.map((message, index) => (
                  <div
                    key={index}
                    className={`flex ${
                      message.role === 'student' ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg px-4 py-2 ${
                        message.role === 'student'
                          ? 'bg-blue-500 text-white'
                          : 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 border border-zinc-200 dark:border-zinc-700'
                      }`}
                    >
                      <div className="text-sm whitespace-pre-wrap">
                        {message.role === 'tutor' ? (
                          <MathText>{message.content}</MathText>
                        ) : (
                          message.content
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {state.isStreaming && (
                  <div className="flex justify-start">
                    <div className="max-w-[80%] rounded-lg px-4 py-2 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 border border-zinc-200 dark:border-zinc-700">
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm text-zinc-500">Thinking...</span>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Input Area */}
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Type your response..."
              disabled={state.isStreaming}
              className="flex-1 px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            />
            <Button
              onClick={handleSend}
              disabled={!inputValue.trim() || state.isStreaming}
              className="px-4"
            >
              {state.isStreaming ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>

          {/* Give Up Button */}
          <div className="flex justify-center pt-2">
            <Button
              variant="outline"
              onClick={() => setShowStaticExplanation(true)}
              className="text-sm"
            >
              Give Up / Show Explanation
            </Button>
          </div>

          {/* Error Display */}
          {state.error && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Render static explanation for incorrect answers (after "Give Up")
  if (!isCorrect && showStaticExplanation && solutionText) {
    return (
      <div className="border-t border-zinc-200 dark:border-zinc-700 pt-4 mt-4">
        <div className="p-4 rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Explanation
            </span>
          </div>
          <div className="text-sm text-zinc-900 dark:text-white whitespace-pre-line">
            <MathText>{solutionText}</MathText>
          </div>
        </div>
      </div>
    );
  }

  // Fallback: No explanation available
  return (
    <div className="border-t border-zinc-200 dark:border-zinc-700 pt-4 mt-4">
      <div className="p-4 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No explanation available for this question.
        </p>
      </div>
    </div>
  );
}
