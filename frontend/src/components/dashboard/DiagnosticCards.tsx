'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Calculator, BookOpen, CheckCircle2, Stethoscope } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useExam } from '@/src/context/ExamContext';

// Diagnostic exam UUIDs (must match backend)
const DIAGNOSTIC_MATH_UUID = '550e8400-e29b-41d4-a716-446655440000';
const DIAGNOSTIC_RW_UUID = '550e8400-e29b-41d4-a716-446655440001';

interface DiagnosticCardsProps {
  sessions: Array<{
    id: string;
    examId: string;
    status: string;
    finalScore?: number | null;
  }>;
  isLoading?: boolean;
  userId?: string;
}

interface DiagnosticStatus {
  isCompleted: boolean;
  score: number | null;
  sessionId: string | null;
}

export default function DiagnosticCards({ sessions, isLoading = false, userId }: DiagnosticCardsProps) {
  const router = useRouter();
  const { actions } = useExam();
  const [startingMath, setStartingMath] = useState(false);
  const [startingRW, setStartingRW] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check completion status for each diagnostic
  const mathStatus: DiagnosticStatus = (() => {
    // Check both examId and exam_id (for compatibility)
    const completedSession = sessions.find(
      (s) => (s.examId === DIAGNOSTIC_MATH_UUID || (s as any).exam_id === DIAGNOSTIC_MATH_UUID) && s.status === 'completed'
    );
    return {
      isCompleted: !!completedSession,
      score: completedSession?.finalScore ?? (completedSession as any)?.score ?? null,
      sessionId: completedSession?.id ?? null,
    };
  })();

  const rwStatus: DiagnosticStatus = (() => {
    // Check both examId and exam_id (for compatibility)
    const completedSession = sessions.find(
      (s) => (s.examId === DIAGNOSTIC_RW_UUID || (s as any).exam_id === DIAGNOSTIC_RW_UUID) && s.status === 'completed'
    );
    return {
      isCompleted: !!completedSession,
      score: completedSession?.finalScore ?? (completedSession as any)?.score ?? null,
      sessionId: completedSession?.id ?? null,
    };
  })();

  const handleStartMath = async () => {
    if (!userId) {
      setError('Please sign in to start diagnostic');
      return;
    }

    try {
      setError(null);
      setStartingMath(true);

      // Create session for Math diagnostic
      const sessionId = await actions.startDiagnostic('DIAGNOSTIC_MATH');
      
      // Navigate to the diagnostic exam page (not simulation)
      router.push(`/exam/diagnostic/${sessionId}`);
    } catch (err: any) {
      console.error('Failed to start Math diagnostic:', err);
      setError(err.message || 'Failed to start Math diagnostic. Please try again.');
      setStartingMath(false);
    }
  };

  const handleStartRW = async () => {
    if (!userId) {
      setError('Please sign in to start diagnostic');
      return;
    }

    try {
      setError(null);
      setStartingRW(true);

      // Create session for R&W diagnostic
      const sessionId = await actions.startDiagnostic('DIAGNOSTIC_RW');
      
      // Navigate to the diagnostic exam page (not simulation)
      router.push(`/exam/diagnostic/${sessionId}`);
    } catch (err: any) {
      console.error('Failed to start R&W diagnostic:', err);
      setError(err.message || 'Failed to start R&W diagnostic. Please try again.');
      setStartingRW(false);
    }
  };

  return (
    <div className="mb-12">
      <div className="flex items-center gap-2 mb-6">
        <Stethoscope className="h-5 w-5 text-purple-600 dark:text-purple-400" />
        <h3 className="text-2xl font-semibold text-black dark:text-zinc-50">
          Diagnostic Tests
        </h3>
        <Badge variant="outline" className="ml-2 bg-purple-50 text-purple-700 border-purple-200">
          Baseline
        </Badge>
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-6">
        Take diagnostic tests to establish your baseline and identify areas for improvement. Each diagnostic can only be taken once.
      </p>

      {error && (
        <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Math Diagnostic Card */}
        <Card className={`border-2 transition-all ${
          mathStatus.isCompleted
            ? 'border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/20 opacity-75'
            : 'border-purple-200 dark:border-purple-800 bg-gradient-to-br from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20 shadow-lg hover:shadow-xl'
        }`}>
          <CardContent className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className={`p-3 rounded-lg ${
                  mathStatus.isCompleted
                    ? 'bg-gray-200 dark:bg-gray-800'
                    : 'bg-purple-100 dark:bg-purple-900/30'
                }`}>
                  <Calculator className={`h-6 w-6 ${
                    mathStatus.isCompleted
                      ? 'text-gray-500 dark:text-gray-400'
                      : 'text-purple-600 dark:text-purple-400'
                  }`} />
                </div>
                <div>
                  <h4 className="text-xl font-bold text-black dark:text-zinc-50">
                    Math Diagnostic
                  </h4>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    Establish your baseline Elo
                  </p>
                </div>
              </div>
              {mathStatus.isCompleted && (
                <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400 flex-shrink-0" />
              )}
            </div>

            {mathStatus.isCompleted ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span className="font-medium">Completed</span>
                  {mathStatus.score !== null && (
                    <span className="ml-2">• Est. Score: {Math.round(mathStatus.score)}</span>
                  )}
                </div>
                <Button
                  disabled
                  className="w-full bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                >
                  Completed
                </Button>
              </div>
            ) : (
              <Button
                onClick={handleStartMath}
                disabled={isLoading || startingMath}
                className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold shadow-lg hover:shadow-xl transition-all"
                size="lg"
              >
                {startingMath ? 'Starting...' : 'Start Math'}
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Reading & Writing Diagnostic Card */}
        <Card className={`border-2 transition-all ${
          rwStatus.isCompleted
            ? 'border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/20 opacity-75'
            : 'border-blue-200 dark:border-blue-800 bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-900/20 dark:to-cyan-900/20 shadow-lg hover:shadow-xl'
        }`}>
          <CardContent className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className={`p-3 rounded-lg ${
                  rwStatus.isCompleted
                    ? 'bg-gray-200 dark:bg-gray-800'
                    : 'bg-blue-100 dark:bg-blue-900/30'
                }`}>
                  <BookOpen className={`h-6 w-6 ${
                    rwStatus.isCompleted
                      ? 'text-gray-500 dark:text-gray-400'
                      : 'text-blue-600 dark:text-blue-400'
                  }`} />
                </div>
                <div>
                  <h4 className="text-xl font-bold text-black dark:text-zinc-50">
                    Reading & Writing
                  </h4>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    Establish your baseline Elo
                  </p>
                </div>
              </div>
              {rwStatus.isCompleted && (
                <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400 flex-shrink-0" />
              )}
            </div>

            {rwStatus.isCompleted ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span className="font-medium">Completed</span>
                  {rwStatus.score !== null && (
                    <span className="ml-2">• Est. Score: {Math.round(rwStatus.score)}</span>
                  )}
                </div>
                <Button
                  disabled
                  className="w-full bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                >
                  Completed
                </Button>
              </div>
            ) : (
              <Button
                onClick={handleStartRW}
                disabled={isLoading || startingRW}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-lg hover:shadow-xl transition-all"
                size="lg"
              >
                {startingRW ? 'Starting...' : 'Start R&W'}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 text-center mt-2">
        ⚠️ Estimated scores are for training purposes only and do not predict official SAT scores.
      </p>
    </div>
  );
}
