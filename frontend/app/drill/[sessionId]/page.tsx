'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import ExamRunner from '@/src/components/ExamRunner';
import { ExamConfig } from '@/src/types/ExamConfig';
import api from '@/lib/api';

/**
 * Drill Page
 * 
 * Daily practice drill mode (10 questions):
 * - Timer counts up (time spent)
 * - No auto-submit at zero
 * - Immediate feedback enabled
 * - Tutor enabled
 * - Linear routing
 */
export default function DrillPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.sessionId as string;

  const [totalQuestions, setTotalQuestions] = useState<number>(10);
  const [questionIds, setQuestionIds] = useState<string[]>([]);
  const [initialQuestionIndex, setInitialQuestionIndex] = useState<number>(0);
  const [initialTimeRemaining, setInitialTimeRemaining] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Drill mode config
  const config: ExamConfig = {
    mode: 'drill',
    timer: {
      show: true,
      direction: 'up', // Count up (time spent)
      autoSubmitAtZero: false, // Don't force-submit
    },
    feedback: {
      allowImmediateCheck: true, // Show "Check Answer" button
      showCorrectness: true, // Highlight green/red
    },
    tutor: {
      enabled: true, // Show "Ask AI" button
    },
    routing: {
      type: 'linear', // Fixed order for drills
    },
  };

  // Fetch session and exam data
  useEffect(() => {
    const fetchExamData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch session data
        const sessionResponse = await api.get(`/sessions/${sessionId}`);
        const sessionData = sessionResponse.data;

        // Get current question index (0-based)
        const currentIndex = sessionData.current_item_index || 0;
        setInitialQuestionIndex(currentIndex);

        // For drill mode (count-up timer), we don't need expires_at
        // Timer will start from 0 and count up
        setInitialTimeRemaining(0);

        // Fetch exam structure to get total questions and question IDs
        if (sessionData.exam_id) {
          try {
            const examResponse = await api.get(`/exams/${sessionData.exam_id}`);
            const structure = examResponse.data.structure;

            if (structure?.items && Array.isArray(structure.items)) {
              // Extract question IDs from structure
              const ids = structure.items
                .map((item: any) => {
                  if (typeof item === 'string') return item;
                  return item.item_id || item.id || '';
                })
                .filter((id: string) => id);

              setQuestionIds(ids);
              setTotalQuestions(structure.items.length);
            } else {
              // Fallback: try to get from metadata
              const itemCount = structure?.metadata?.question_count || 10;
              setTotalQuestions(itemCount);
            }
          } catch (examErr) {
            console.warn('Could not fetch exam structure:', examErr);
            // Use default values
            setTotalQuestions(10);
          }
        } else {
          // No exam_id, use defaults
          setTotalQuestions(10);
        }
      } catch (err: any) {
        console.error('Failed to fetch exam data:', err);
        setError(err.response?.data?.detail || err.message || 'Failed to load drill');
      } finally {
        setLoading(false);
      }
    };

    if (sessionId) {
      fetchExamData();
    }
  }, [sessionId]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="text-lg text-gray-700">Loading Drill...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="text-red-600 p-4 bg-red-50 border border-red-200 rounded">
          {error}
        </div>
      </div>
    );
  }

  return (
    <ExamRunner
      sessionId={sessionId}
      totalQuestions={totalQuestions}
      initialQuestionIndex={initialQuestionIndex}
      initialTimeRemaining={initialTimeRemaining}
    />
  );
}
