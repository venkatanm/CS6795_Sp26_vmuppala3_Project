'use client';

import ExamRunner from '@/src/components/ExamRunner';
import { ExamProvider } from '@/src/context/ExamContext';
import { MOCK_EXAM_CONFIG, MOCK_EXAM_PACKET, MOCK_SESSION_ID } from '@/src/mocks/mock-exam-config';

/**
 * UI Smoke Test Page
 * 
 * This route renders ExamRunner with mock data to verify UI components
 * render correctly in isolation without database or API dependencies.
 * 
 * Access at: /test/ui
 * 
 * Validation Checklist:
 * - [ ] Can I see the Header?
 * - [ ] Does the Timer show "00:00" or count?
 * - [ ] Can I see the question text?
 * - [ ] Can I see the answer options?
 * - [ ] Can I click "Next" button?
 * - [ ] Can I click "Back" button?
 * - [ ] Does the BottomBar render?
 */
export default function UITestPage() {
  // Extract question IDs from mock packet
  const questionIds = MOCK_EXAM_PACKET.modules[0]?.question_order || ['mock_q_001'];
  const totalQuestions = questionIds.length;

  return (
    <div className="min-h-screen bg-white">
      {/* Test Info Banner */}
      <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-2 text-sm text-yellow-800">
        <strong>UI Smoke Test Mode</strong> - Using mock data. No API calls will be made.
      </div>

      {/* Wrap ExamRunner with ExamProvider */}
      <ExamProvider>
        <ExamRunner
          sessionId={MOCK_SESSION_ID}
          totalQuestions={totalQuestions}
          initialQuestionIndex={0}
          initialTimeRemaining={3600}
        />
      </ExamProvider>
    </div>
  );
}
