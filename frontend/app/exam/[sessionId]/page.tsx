'use client';

import { useParams } from 'next/navigation';
import ExamRunner from '@/src/components/ExamRunner';
import { ExamProvider } from '@/src/context/ExamContext';

/**
 * Exam Page
 * 
 * Wrapper page that renders ExamRunner with offline-first ExamContext.
 * Uses local IndexedDB - no API calls.
 */
export default function ExamPage() {
  const params = useParams();
  const sessionId = params.sessionId as string;

  return (
    <ExamProvider>
      <ExamRunner
        sessionId={sessionId}
        totalQuestions={27}
        initialQuestionIndex={0}
        initialTimeRemaining={1920}
      />
    </ExamProvider>
  );
}
