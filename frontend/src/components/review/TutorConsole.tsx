'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Loader2, CheckCircle2, XCircle, Clock, BookOpen, Lightbulb } from 'lucide-react';
import { Accordion } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useTutorSession } from '@/src/hooks/useTutorSession';
import MathRenderer from '@/src/components/math/MathRenderer';

interface ReviewItem {
  item_id: string;
  question_text: string;
  user_selected_id: number;
  correct_option_id: number;
  is_correct: boolean;
  options: (number | string)[];
  is_spr?: boolean;
  correct_answer?: string;
  user_answer?: string;
  solution_text?: string | null;
  skill_tag?: string | null;
  time_spent?: number | null;
  
  // AI-generated fields
  ai_explanation?: string;
  distractor_analysis?: Record<string, string>;
  hint_sequence?: string[];
  stimulus?: string;
  domain?: string;
}

interface TutorConsoleProps {
  item: ReviewItem;
  sessionId: string;
}

/**
 * TutorConsole Component
 * 
 * The intelligent right pane that displays AI insights and handles follow-up chat.
 * Vertical flex column structure: Header (Verdict) -> Analysis (Scrollable) -> Chat (Sticky Bottom)
 */
export default function TutorConsole({ item, sessionId }: TutorConsoleProps) {
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

  // Initialize session when question changes; cleanup on unmount or question change
  useEffect(() => {
    if (item.item_id && sessionId) {
      initializeSession(item.item_id, sessionId, item.user_selected_id);
    }
    return () => {
      clearSession();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only re-run when question/session changes; omit callbacks to avoid infinite loop from unstable refs
  }, [item.item_id, sessionId, item.user_selected_id]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [state.messages, state.isStreaming]);

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

  // Get option label (A, B, C, D) from option index
  const getOptionLabel = (optionIndex: number): string =>
    optionIndex >= 0 && optionIndex < 26 ? String.fromCharCode(65 + optionIndex) : 'Unknown';
  const userSelectedLabel = getOptionLabel(item.user_selected_id);
  const correctAnswerLabel = getOptionLabel(item.correct_option_id);
  const distractorText = !item.is_correct && !item.is_spr && item.distractor_analysis
    ? item.distractor_analysis[userSelectedLabel]
    : null;

  // Render text with **bold** and \(LaTeX\) support
  const renderFormattedText = (text: string) => {
    if (!text) return null;
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return (
      <span className="whitespace-pre-line">
        {parts.map((part, i) => {
          if (part.startsWith('**') && part.endsWith('**')) {
            return <strong key={i}><MathRenderer>{part.slice(2, -2)}</MathRenderer></strong>;
          }
          return <MathRenderer key={i}>{part}</MathRenderer>;
        })}
      </span>
    );
  };

  // Format time spent
  const formatTimeSpent = (seconds: number): string => {
    if (seconds < 60) {
      return `${Math.round(seconds)}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    if (remainingSeconds === 0) {
      return `${minutes}m`;
    }
    return `${minutes}m ${remainingSeconds}s`;
  };

  return (
    <div className="h-full flex flex-col bg-white dark:bg-zinc-950 border-l border-zinc-200 dark:border-zinc-800">
      {/* 1. Header (Verdict) */}
      <div className={`p-4 border-b-2 ${
        item.is_correct
          ? 'bg-green-50 dark:bg-green-900/20 border-green-500 dark:border-green-600'
          : 'bg-red-50 dark:bg-red-900/20 border-red-500 dark:border-red-600'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {item.is_correct ? (
              <CheckCircle2 className="w-6 h-6 text-green-600 dark:text-green-400" />
            ) : (
              <XCircle className="w-6 h-6 text-red-600 dark:text-red-400" />
            )}
            <span className={`text-lg font-semibold ${
              item.is_correct
                ? 'text-green-700 dark:text-green-300'
                : 'text-red-700 dark:text-red-300'
            }`}>
              {item.is_correct ? 'Correct' : 'Incorrect'}
            </span>
          </div>
          {item.time_spent !== undefined && item.time_spent !== null && (
            <Badge variant="outline" className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatTimeSpent(item.time_spent)}
            </Badge>
          )}
        </div>
      </div>

      {/* 2. Feedback Section (Scrollable) - right pane */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* A. Correct Answer box (only when incorrect) - right above Step-by-Step Solution */}
        {!item.is_correct && (
          <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
            <p className="text-sm font-semibold text-green-800 dark:text-green-200 mb-2">
              {item.is_spr ? (
                <>The correct answer is {item.correct_answer ? renderFormattedText(String(item.correct_answer)) : '—'}.</>
              ) : (
                <>The correct answer is option {correctAnswerLabel}.</>
              )}
            </p>
            {distractorText && userSelectedLabel !== correctAnswerLabel && (
              <>
                <h3 className="text-sm font-semibold text-red-900 dark:text-red-200 mb-1">
                  Why option {userSelectedLabel} is incorrect:
                </h3>
                <p className="text-sm text-red-800 dark:text-red-300">
                  {renderFormattedText(distractorText)}
                </p>
              </>
            )}
          </div>
        )}

        {/* B. Full Solution Accordion - open if wrong, closed if correct */}
        {(item.ai_explanation || item.solution_text) && (
          <Accordion
            key={`solution-${item.item_id}`}
            title="📝 View Step-by-Step Solution"
            icon={<BookOpen className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />}
            defaultOpen={false}
            className="bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-700"
          >
            <div className="prose prose-sm max-w-none text-zinc-700 dark:text-zinc-300 p-4">
              {renderFormattedText(item.ai_explanation || item.solution_text || '')}
            </div>
          </Accordion>
        )}

        {/* C. Hints Accordion - always closed by default */}
        {item.hint_sequence && item.hint_sequence.length > 0 && (
          <Accordion
            key={`hints-${item.item_id}`}
            title={`💡 View Hints Breakdown (${item.hint_sequence.length})`}
            icon={<Lightbulb className="w-4 h-4 text-amber-500 shrink-0" />}
            defaultOpen={false}
            className="bg-amber-50/50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800"
          >
            <ul className="list-decimal list-inside space-y-2 p-4 text-sm text-zinc-700 dark:text-zinc-300">
              {item.hint_sequence.map((hint, i) => (
                <li key={i} className="pl-2 marker:font-bold marker:text-amber-600 dark:marker:text-amber-400">
                  {renderFormattedText(hint)}
                </li>
              ))}
            </ul>
          </Accordion>
        )}
      </div>

      {/* 3. Chat Interface (Sticky Bottom) - clean prompt, no quick actions */}
      <div className="border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-4 space-y-3">
        {/* Messages Container */}
        <div className="min-h-[120px] max-h-[200px] overflow-y-auto p-3 rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700">
          {state.messages.length === 0 && !state.isStreaming ? (
            <div className="text-sm text-zinc-500 dark:text-zinc-400 text-center py-4">
              Ask a question about this problem...
            </div>
          ) : (
            <div className="space-y-2">
              {state.messages.map((message, index) => (
                <div
                  key={index}
                  className={`flex ${
                    message.role === 'student' ? 'justify-end' : 'justify-start'
                  }`}
                >
                  <div
                    className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                      message.role === 'student'
                        ? 'bg-blue-500 text-white'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50'
                    }`}
                  >
                    <div className="whitespace-pre-wrap">
                      {message.role === 'tutor' ? (
                        renderFormattedText(message.content)
                      ) : (
                        message.content
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {state.isStreaming && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] rounded-lg px-3 py-2 bg-zinc-100 dark:bg-zinc-800">
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />
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
            placeholder="Ask a question..."
            disabled={state.isStreaming || !state.isInitialized}
            className="flex-1 px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
          <Button
            onClick={handleSend}
            disabled={!inputValue.trim() || state.isStreaming || !state.isInitialized}
            size="sm"
            className="px-3"
          >
            {state.isStreaming ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>

        {/* Error Display */}
        {state.error && (
          <div className="p-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
            <p className="text-xs text-red-700 dark:text-red-400">{state.error}</p>
          </div>
        )}
      </div>
    </div>
  );
}
