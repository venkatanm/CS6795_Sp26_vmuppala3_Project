'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardContent, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import ChatPanel from '@/src/components/tutor/ChatPanel';
import MathText from '@/components/exam/MathText';
import { CheckCircle2, XCircle, X } from 'lucide-react';

export interface DailyQuestionCardProps {
  /** Question ID */
  questionId: string;
  /** Session ID */
  sessionId: string;
  /** Question text */
  questionText: string;
  /** Stimulus/passage text (optional) - standardized on stimulus */
  stimulus?: string;
  /** @deprecated Use stimulus instead. Kept for backward compatibility. */
  passageText?: string;
  /** Answer choices */
  choices: Array<{ id: string; text: string }>;
  /** Correct answer ID */
  correctAnswerId: string;
  /** Current question index (0-based) */
  questionIndex: number;
  /** Total number of questions */
  totalQuestions: number;
  /** Student's current score */
  studentScore: number;
  /** Callback when moving to next question */
  onNextQuestion: () => void;
}

/**
 * DailyQuestionCard Component
 * 
 * Displays a single question in Daily Test mode with immediate feedback.
 * 
 * Flow:
 * - Submit -> Correct: Toast + Auto-advance after 1.5s
 * - Submit -> Wrong: Pause + Open ChatPanel instantly
 * - Student chats -> Clicks "Next Question" -> Move to next
 */
export default function DailyQuestionCard({
  questionId,
  sessionId,
  questionText,
  stimulus,
  passageText,
  choices,
  correctAnswerId,
  questionIndex,
  totalQuestions,
  studentScore,
  onNextQuestion,
}: DailyQuestionCardProps) {
  // Standardize on stimulus (primary), with fallback to passageText for backward compatibility
  const passageContent = stimulus || passageText;
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [showChatPanel, setShowChatPanel] = useState(false);
  const [autoAdvanceTimer, setAutoAdvanceTimer] = useState<NodeJS.Timeout | null>(null);
  const [toastMessage, setToastMessage] = useState<{ title: string; description?: string; type: 'success' | 'error' } | null>(null);

  // Clear timer on unmount
  useEffect(() => {
    return () => {
      if (autoAdvanceTimer) {
        clearTimeout(autoAdvanceTimer);
      }
    };
  }, [autoAdvanceTimer]);

  const handleSubmit = () => {
    if (!selectedAnswer) {
      setToastMessage({
        title: 'Please select an answer',
        type: 'error',
      });
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }

    setIsSubmitted(true);
    const correct = selectedAnswer === correctAnswerId;
    setIsCorrect(correct);

    if (correct) {
      // Correct answer: Show toast and auto-advance
      setToastMessage({
        title: 'Correct! 🎉',
        description: 'Great job! Moving to the next question...',
        type: 'success',
      });

      // Auto-advance after 1.5 seconds
      const timer = setTimeout(() => {
        setToastMessage(null);
        handleNextQuestion();
      }, 1500);
      setAutoAdvanceTimer(timer);
    } else {
      // Wrong answer: Pause and open chat panel
      setShowChatPanel(true);
      // Don't auto-advance - student must click "Next Question"
    }
  };

  const handleNextQuestion = () => {
    // Clear any pending timers
    if (autoAdvanceTimer) {
      clearTimeout(autoAdvanceTimer);
      setAutoAdvanceTimer(null);
    }

    // Reset state
    setSelectedAnswer(null);
    setIsSubmitted(false);
    setIsCorrect(null);
    setShowChatPanel(false);

    // Move to next question
    onNextQuestion();
  };

  const handleAnswerSelect = (answerId: string) => {
    if (!isSubmitted) {
      setSelectedAnswer(answerId);
    }
  };

  return (
    <>
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 px-6 py-4 rounded-lg shadow-lg flex items-center gap-4 transition-all duration-300 ease-in-out bg-white dark:bg-zinc-800 border-2 border-zinc-200 dark:border-zinc-700">
          <div className={`flex-1 ${toastMessage.type === 'success' ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
            <div className="font-medium">{toastMessage.title}</div>
            {toastMessage.description && (
              <div className="text-sm mt-1">{toastMessage.description}</div>
            )}
          </div>
          <button
            onClick={() => setToastMessage(null)}
            className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
      )}

      <Card className="w-full max-w-4xl mx-auto">
        <CardHeader>
          <div className="flex items-center justify-between mb-4">
            <CardTitle className="text-xl">
              Question {questionIndex + 1} of {totalQuestions}
            </CardTitle>
            {isSubmitted && isCorrect !== null && (
              <Badge variant={isCorrect ? 'default' : 'destructive'}>
                {isCorrect ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-1" />
                    Correct
                  </>
                ) : (
                  <>
                    <XCircle className="w-4 h-4 mr-1" />
                    Incorrect
                  </>
                )}
              </Badge>
            )}
          </div>

          {/* Passage (if available) - rendered ABOVE question stem, as HTML to preserve formatting */}
          {passageContent && (
            <div className="mb-4 pb-4 border-b border-zinc-200 dark:border-zinc-700">
              <div
                className="text-base text-zinc-700 dark:text-zinc-300 leading-relaxed prose prose-sm max-w-none dark:prose-invert [&_table]:border [&_table]:border-collapse [&_td]:border [&_th]:border [&_td]:p-2 [&_th]:p-2"
                dangerouslySetInnerHTML={{ __html: passageContent }}
              />
            </div>
          )}

          {/* Question Stem */}
          <div className="text-lg text-zinc-900 dark:text-zinc-50 mb-4">
            <MathText>{questionText}</MathText>
          </div>
        </CardHeader>

        <CardContent>
          {/* Answer Choices */}
          <div className="space-y-3 mb-6">
            {choices.map((choice) => {
              const isSelected = selectedAnswer === choice.id;
              const isCorrectChoice = choice.id === correctAnswerId;
              const isWrongSelection = isSelected && !isCorrectChoice && isSubmitted;

              let bgClass = 'bg-white dark:bg-zinc-900';
              let borderClass = 'border-zinc-200 dark:border-zinc-700';
              let textClass = 'text-zinc-900 dark:text-zinc-50';

              if (isSubmitted) {
                if (isCorrectChoice) {
                  bgClass = 'bg-green-100 dark:bg-green-900/30';
                  borderClass = 'border-green-500 dark:border-green-600';
                  textClass = 'text-green-900 dark:text-green-50';
                } else if (isWrongSelection) {
                  bgClass = 'bg-red-100 dark:bg-red-900/30';
                  borderClass = 'border-red-500 dark:border-red-600';
                  textClass = 'text-red-900 dark:text-red-50';
                }
              } else if (isSelected) {
                bgClass = 'bg-blue-100 dark:bg-blue-900/30';
                borderClass = 'border-blue-500 dark:border-blue-600';
                textClass = 'text-blue-900 dark:text-blue-50';
              }

              return (
                <button
                  key={choice.id}
                  onClick={() => handleAnswerSelect(choice.id)}
                  disabled={isSubmitted}
                  className={`w-full text-left p-4 rounded-lg border-2 transition-all ${bgClass} ${borderClass} ${textClass} ${
                    !isSubmitted ? 'hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer' : 'cursor-default'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      <MathText>{choice.text}</MathText>
                    </span>
                    {isSubmitted && isCorrectChoice && (
                      <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
                    )}
                    {isWrongSelection && (
                      <XCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Submit Button */}
          {!isSubmitted && (
            <div className="flex justify-end">
              <Button
                onClick={handleSubmit}
                disabled={!selectedAnswer}
                size="lg"
              >
                Submit Answer
              </Button>
            </div>
          )}

          {/* Auto-advance indicator for correct answers */}
          {isSubmitted && isCorrect && (
            <div className="text-center text-sm text-zinc-500 dark:text-zinc-400 mt-4">
              Moving to next question...
            </div>
          )}
        </CardContent>
      </Card>

      {/* Chat Panel for wrong answers */}
      {showChatPanel && (
        <ChatPanel
          isOpen={showChatPanel}
          onClose={() => setShowChatPanel(false)}
          questionId={questionId}
          sessionId={sessionId}
          studentAnswer={selectedAnswer || undefined}
          questionText={questionText}
          mode="daily"
          onNextQuestion={handleNextQuestion}
          initialMessage={`I see you picked ${selectedAnswer}. Walk me through your logic.`}
        />
      )}
    </>
  );
}
