'use client';

import { ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import styles from './BottomBar.module.css';

interface BottomBarProps {
  /** Current question number (1-based) */
  currentQuestion: number;
  
  /** Total number of questions */
  totalQuestions: number;
  
  /** Current question ID */
  questionId: string;
  
  /** Session ID */
  sessionId: string;
  
  /** Callback when Next button is clicked */
  onNext: () => void;
  
  /** Callback when Back button is clicked */
  onPrev?: () => void;
  
  /** Whether Back button should be disabled */
  isPrevDisabled?: boolean;
  
  /** Callback when Review Grid button is clicked */
  onReviewGrid?: () => void;
  
  /** Whether Next button should be disabled */
  isNextDisabled?: boolean;
  
  /** Custom text for Next button (e.g., "Finish" or "Next Module") */
  nextButtonText?: string;
  
  /** Student/User name to display */
  studentName?: string;
}

/**
 * BottomBar Component
 * 
 * Bluebook-style bottom navigation bar with:
 * - Left: Student name
 * - Center: Question counter button (opens review grid)
 * - Right: Next button
 */
export default function BottomBar({
  currentQuestion,
  totalQuestions,
  questionId,
  sessionId,
  onNext,
  onPrev,
  onReviewGrid,
  isNextDisabled = false,
  isPrevDisabled = false,
  nextButtonText = 'Next',
  studentName = 'Student',
}: BottomBarProps) {
  return (
    <div className={styles.bottomBar}>
      {/* Left: Student Name */}
      <div className={styles.leftSection}>
        <div className={styles.studentNameButton}>
          {studentName}
        </div>
      </div>

      {/* Center: Question Counter Button - Opens Review Grid */}
      <div className={styles.centerSection}>
        {onReviewGrid && (
          <button
            onClick={onReviewGrid}
            className={styles.questionCounterButton}
            aria-label={`Question ${currentQuestion} of ${totalQuestions}. Click to review all questions.`}
          >
            Question {currentQuestion} of {totalQuestions}
            <ChevronUp className="h-4 w-4 ml-1" />
          </button>
        )}
      </div>

      {/* Right: Navigation Buttons */}
      <div className={styles.rightSection}>
        {onPrev && (
          <Button
            variant="outline"
            onClick={onPrev}
            disabled={isPrevDisabled || currentQuestion === 1}
            className={styles.backButton}
          >
            Back
          </Button>
        )}
        <Button
          variant="default"
          onClick={onNext}
          disabled={isNextDisabled}
          className={styles.nextButton}
        >
          {nextButtonText}
        </Button>
      </div>
    </div>
  );
}
