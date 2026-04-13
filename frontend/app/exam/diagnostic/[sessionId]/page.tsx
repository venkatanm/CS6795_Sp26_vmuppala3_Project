'use client';

import { useParams } from 'next/navigation';
import ExamRunner from '@/src/components/ExamRunner';
import { ExamConfig } from '@/src/types/ExamConfig';
import { ExamProvider } from '@/src/context/ExamContext';

/**
 * Diagnostic Exam Page
 * 
 * 24-question diagnostic test mode (12 per module):
 * - Timer counts down
 * - Auto-submits at zero
 * - No immediate feedback
 * - Aggressive routing (adaptive)
 * 
 * Uses offline-first ExamContext - no API calls.
 */
export default function DiagnosticExamPage() {
  const params = useParams();
  const sessionId = params.sessionId as string;

  // Diagnostic mode config
  const config: ExamConfig = {
    mode: 'diagnostic',
    timer: {
      show: true,
      direction: 'down',
      autoSubmitAtZero: true,
    },
    feedback: {
      allowImmediateCheck: false,
      showCorrectness: false,
    },
    tutor: {
      enabled: true, // Enable tutor for diagnostic exams in review mode
    },
    routing: {
      type: 'aggressive', // Adaptive routing for diagnostics
    },
  };

  return (
    <ExamProvider>
      <ExamRunner
        sessionId={sessionId}
        totalQuestions={24}
        initialQuestionIndex={0}
        initialTimeRemaining={3600}
      />
    </ExamProvider>
  );
}
