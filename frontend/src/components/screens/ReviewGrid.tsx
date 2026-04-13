'use client';

import { useState, useEffect } from 'react';
import { Flag, X } from 'lucide-react';
import { db, AnnotationRecord, ResponseRecord } from '@/src/lib/db';
import { useExam } from '@/src/context/ExamContext';
import { ExamPacket } from '@/src/types/ExamPacket';
import { Button } from '@/components/ui/button';
import styles from './ReviewGrid.module.css';

interface QuestionStatus {
  questionId: string;
  questionNumber: number;
  isAnswered: boolean;
  isMarkedForReview: boolean;
  isCurrent: boolean;
  /** Whether the answer is correct (only shown if feedbackPolicy is 'immediate') */
  isCorrect?: boolean;
}

interface ReviewGridProps {
  /** Total number of questions */
  totalQuestions: number;
  
  /** Current question ID */
  currentQuestionId: string;
  
  /** Current question number (1-based) */
  currentQuestionNumber: number;
  
  /** Session ID */
  sessionId: string;
  
  /** Array of question IDs in order */
  questionIds: string[];
  
  /** Section name (e.g., "Section 1: Reading and Writing") */
  sectionName?: string;
  
  /** Callback when a question is clicked */
  onQuestionClick: (questionId: string, questionNumber: number) => void;
  
  /** Optional callback when grid is closed */
  onClose?: () => void;
  
  /** Optional callback for "Go to Review Page" button */
  onGoToReviewPage?: () => void;
}

/**
 * ReviewGrid Component
 * 
 * Responsive grid view showing all questions with visual states:
 * - Empty (dashed border): Unanswered
 * - Solid Blue/Black (filled background): Answered
 * - Red Flag icon: Marked for Review
 * - Blue Pin icon: Current question
 * 
 * Clicking a question deep-links directly to that question.
 */
export default function ReviewGrid({
  totalQuestions,
  currentQuestionId,
  currentQuestionNumber,
  sessionId,
  questionIds,
  sectionName = 'Section 1: Reading and Writing',
  onQuestionClick,
  onClose,
  onGoToReviewPage,
}: ReviewGridProps) {
  const { state } = useExam();
  const [isOpen, setIsOpen] = useState(true);
  const [questionStatuses, setQuestionStatuses] = useState<QuestionStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [examPacket, setExamPacket] = useState<ExamPacket | null>(null);

  // Get config from exam packet or use defaults
  const config = examPacket?.config ?? {
    total_time: 3600,
    allowed_tools: [],
  };
  
  // Check if feedback should be shown (default to false for exams)
  const showCorrectness = false; // Exams typically don't show correctness during the exam

  // Load exam packet for immediate feedback (if needed)
  useEffect(() => {
    const loadExamPacket = async () => {
      if (showCorrectness) {
        // Note: Exam packets are no longer cached in IndexedDB.
        // ReviewGrid should use currentModule from ExamContext or fetch from backend if needed.
        // For now, we'll rely on ExamContext's currentModule state.
        console.log('[ReviewGrid] Exam packet caching removed - using ExamContext state');
      }
    };

    if (sessionId && showCorrectness) {
      loadExamPacket();
    }
  }, [sessionId, showCorrectness, state.session?.answers, state.session?.id]);

  // Calculate question statuses from ExamContext state (reactive) + IndexedDB (for correctness and flags)
  useEffect(() => {
    const calculateStatuses = async () => {
      try {
        setIsLoading(true);
        const statuses: QuestionStatus[] = [];

        // Get answers from session
        const answers = state.session?.answers || {};
        const answersArray = Object.entries(answers);

        // Load marked for review flags from annotations
        const flagsSet = new Set<string>();
        try {
          const annotations = await db.annotations
            .where('sessionId')
            .equals(sessionId)
            .toArray();
          annotations.forEach(ann => {
            if (ann.markedForReview) {
              flagsSet.add(ann.questionId);
            }
          });
        } catch (error) {
          console.error('[ReviewGrid] Error loading annotations:', error);
        }

        // Use ExamContext state directly for flags and answers (most up-to-date)
        // This is reactive and updates immediately when user interacts
        const answeredQuestionIds = new Set<string>();
        answersArray.forEach(([questionId, optionId]) => {
          // Only count as answered if optionId is not null/undefined
          if (optionId != null && optionId !== '') {
            answeredQuestionIds.add(questionId);
          }
        });

        // Use flags from annotations (marked for review)
        const markedQuestionIds = flagsSet;

        // Load from IndexedDB only for correctness checking (if needed)
        let responseMap = new Map<string, ResponseRecord>();
        if (showCorrectness && examPacket) {
          const responses = await db.responses
            .where('sessionId')
            .equals(sessionId)
            .toArray();
          
          const validResponses = responses.filter((r) => 
            r.selectedOptionId !== null && r.selectedOptionId !== undefined
          );
          
          responseMap = new Map(
            validResponses.map((r) => [r.questionId, r])
          );
        }

        // Build status array
        for (let i = 0; i < totalQuestions; i++) {
          const questionId = questionIds[i] || `question_${i + 1}`;
          const questionNumber = i + 1;
          const isAnswered = answeredQuestionIds.has(questionId);
          const isMarked = markedQuestionIds.has(questionId);
          const isCurrent = questionId === currentQuestionId;
          
          // Check if answer is correct (only for immediate feedback)
          let isCorrect: boolean | undefined = undefined;
          if (showCorrectness && isAnswered && examPacket) {
            const questionContent = examPacket.content_bank[questionId];
            const response = responseMap.get(questionId);
            if (questionContent && response) {
              const correctAnswer = String(questionContent.correct_answer);
              const selectedAnswer = String(response.selectedOptionId);
              isCorrect = correctAnswer === selectedAnswer;
            }
          }

          statuses.push({
            questionId,
            questionNumber,
            isAnswered,
            isMarkedForReview: isMarked,
            isCurrent: isCurrent,
            isCorrect,
          });
        }

        setQuestionStatuses(statuses);
      } catch (error) {
        console.error('[ReviewGrid] Error calculating question statuses:', error);
      } finally {
        setIsLoading(false);
      }
    };

    if (sessionId && questionIds.length > 0) {
      calculateStatuses();
    }
  }, [
    sessionId, 
    questionIds, 
    totalQuestions, 
    currentQuestionId, 
    showCorrectness, 
    examPacket,
    // Convert to arrays for proper React dependency tracking
    JSON.stringify(state.session?.answers || {}),  // Reactive: updates when answers change
    sessionId,                                       // Reload when session changes
  ]);

  if (isLoading) {
    return (
      <div className={styles.modalOverlay}>
        <div className={styles.modal}>
          <div className={styles.loading}>Loading question status...</div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header with title and close button */}
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>{sectionName} Questions</h2>
          {onClose && (
            <button onClick={onClose} className={styles.closeButton} aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Legend */}
        <div className={styles.legend}>
          <div className={styles.legendItem}>
            <div className={`${styles.legendBox} ${styles.legendBoxUnanswered}`} />
            <span>Unanswered</span>
          </div>
          <div className={styles.legendItem}>
            <div className={`${styles.legendBox} ${styles.legendBoxAnswered}`} />
            <span>Answered</span>
          </div>
          <div className={styles.legendItem}>
            <div className={styles.legendBoxCurrent}>
              <div className={styles.legendCurrentDot} />
            </div>
            <span>Current</span>
          </div>
          <div className={styles.legendItem}>
            <Flag className={styles.legendIconFlag} />
            <span>For Review</span>
          </div>
        </div>

        {/* Divider */}
        <div className={styles.divider} />

        {/* Question Grid - Single row like Bluebook */}
        <div className={styles.grid}>
          {questionStatuses.map((status) => {
            return (
              <button
                key={status.questionId}
                className={`${styles.questionBox} ${
                  status.isAnswered ? styles.answered : styles.unanswered
                } ${status.isMarkedForReview ? styles.marked : ''} ${
                  status.isCurrent ? styles.current : ''
                }`}
                onClick={() => {
                  onQuestionClick(status.questionId, status.questionNumber);
                  if (onClose) onClose();
                }}
                aria-label={`Question ${status.questionNumber}${status.isAnswered ? ', Answered' : ', Unanswered'}${status.isMarkedForReview ? ', Marked for Review' : ''}${status.isCurrent ? ', Current Question' : ''}`}
              >
                <span className={styles.questionNumber}>{status.questionNumber}</span>
                {/* Current indicator - Blue dot (shown first, highest z-index) */}
                {status.isCurrent && (
                  <div className={styles.currentIndicator} />
                )}
                {/* Marked for review - Red flag (shown on top-right) */}
                {status.isMarkedForReview && (
                  <Flag className={styles.flagIcon} />
                )}
              </button>
            );
          })}
        </div>

        {/* Footer with "Go to Review Page" button */}
        {onGoToReviewPage && (
          <div className={styles.modalFooter}>
            <Button
              onClick={() => {
                onGoToReviewPage();
                if (onClose) onClose();
              }}
              className={styles.reviewPageButton}
            >
              Go to Review Page
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
