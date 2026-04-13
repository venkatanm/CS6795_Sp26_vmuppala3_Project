'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import { ExamPacket } from '@/src/types/ExamPacket';
// Note: ExamLoader removed - modules are fetched on-demand from backend
import { aggregateDomainScores, getRoutingInfo, formatDomainName, ResponseData, DomainScore } from '@/src/utils/analytics';

interface ResultsViewProps {
  /** Session ID */
  sessionId: string;
  
  /** Optional callback when returning to dashboard */
  onReturnToDashboard?: () => void;
}

/**
 * ResultsView Component
 * 
 * Displays exam results immediately upon completion:
 * - Big, bold Section Score (200-800)
 * - Routing indicator (Hard/Easy Module 2)
 * - Domain breakdown with accuracy percentages
 * - Navigation button to return to dashboard
 */
export default function ResultsView({ sessionId, onReturnToDashboard }: ResultsViewProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [sectionScore, setSectionScore] = useState<number | null>(null);
  const [routingInfo, setRoutingInfo] = useState<{ nextModuleId: string; isHard: boolean; moduleName: string } | null>(null);
  const [domainScores, setDomainScores] = useState<DomainScore[]>([]);
  const [examPacket, setExamPacket] = useState<ExamPacket | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchResults = async () => {
      try {
        setLoading(true);
        setError(null);

        // Step 1: Fetch session state from Redis (contains routing info and response history)
        const sessionResponse = await api.get(`/sessions/${sessionId}`);
        const sessionState = sessionResponse.data;

        // Step 2: Fetch database session to get section_score
        // We'll need to get this from a different endpoint or include it in the session state
        // For now, try to get it from the database session endpoint
        let dbSectionScore: number | null = null;
        try {
          // Try to get section_score from database
          // Note: This might require a new endpoint or updating the existing one
          // For now, we'll check if it's in the session state
          dbSectionScore = sessionState.section_score || null;
        } catch (err) {
          console.warn('Could not fetch section_score from database:', err);
        }

        // Step 3: Extract routing information
        const routing = getRoutingInfo(sessionState);
        setRoutingInfo(routing);

        // Step 4: Get exam ID and load ExamPacket
        const examId = sessionState.exam_id;
        if (!examId) {
          throw new Error('Exam ID not found in session');
        }

        // Note: Exam packets are no longer cached. 
        // For ResultsView, we can fetch exam structure from backend if needed for domain analysis.
        // For now, we'll skip packet loading - aggregateDomainScores may need to be updated to work without full packet.
        // TODO: Update aggregateDomainScores to fetch domain info from backend or use session data
        setExamPacket(null);

        // Step 5: Extract responses from response_history
        const responseHistory = sessionState.response_history || [];
        const responses: ResponseData[] = responseHistory
          .filter((entry: any) => entry.item_id && typeof entry.is_correct === 'boolean')
          .map((entry: any) => ({
            questionId: entry.item_id,
            isCorrect: entry.is_correct,
            selectedOptionId: entry.selected_option_id,
            timeSpent: entry.time_spent,
            timestamp: entry.timestamp,
          }));

        // Step 6: Calculate domain scores
        // Note: aggregateDomainScores requires examPacket which is no longer cached.
        // TODO: Update to fetch domain info from backend or include in response data
        if (responses.length > 0) {
          // For now, skip domain aggregation - will need backend support
          console.warn('[ResultsView] Domain aggregation skipped - exam packet no longer cached');
          setDomainScores([]);
        }

        // Step 7: Set section score (use section_score if available, otherwise calculate from student_theta)
        if (dbSectionScore !== null) {
          setSectionScore(dbSectionScore);
        } else {
          // Fallback: Try to calculate from student_theta if ScoreEngine is available
          // For now, we'll show student_theta as a placeholder
          const studentTheta = sessionState.student_theta;
          if (studentTheta) {
            // Note: In a real implementation, you'd use ScoreEngine here
            // For now, we'll just show the theta value
            console.warn('section_score not available, using student_theta as fallback');
            setSectionScore(Math.round(studentTheta));
          }
        }

      } catch (err: any) {
        console.error('Failed to fetch results:', err);
        setError(err.response?.data?.detail || err.message || 'Failed to load results');
      } finally {
        setLoading(false);
      }
    };

    if (sessionId) {
      fetchResults();
    }
  }, [sessionId]);

  const handleReturnToDashboard = () => {
    if (onReturnToDashboard) {
      onReturnToDashboard();
    } else {
      router.push('/dashboard');
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-black">
        <div className="text-lg text-zinc-600 dark:text-zinc-400">Loading Results...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-black p-4">
        <Card className="w-full max-w-2xl">
          <CardContent className="pt-6">
            <div className="text-center text-red-600 dark:text-red-400">
              <p className="text-lg font-semibold mb-2">Error Loading Results</p>
              <p className="text-sm">{error}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black p-4">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header: Big, Bold Section Score */}
        <Card className="w-full">
          <CardContent className="pt-6">
            <div className="text-center">
              <div className="text-7xl font-bold mb-4 text-zinc-900 dark:text-zinc-50">
                {sectionScore !== null ? sectionScore : '—'}
              </div>
              <div className="text-xl text-zinc-600 dark:text-zinc-400 font-medium">
                Section Score
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Routing Indicator */}
        {routingInfo && (
          <Card className="w-full">
            <CardContent className="pt-6">
              <div className="text-center">
                <p className="text-lg text-zinc-700 dark:text-zinc-300">
                  You were routed to the <span className="font-bold">{routingInfo.moduleName}</span> Module 2.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Domain Breakdown */}
        {domainScores.length > 0 && (
          <Card className="w-full">
            <CardHeader>
              <CardTitle>Performance by Domain</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {domainScores.map((domainScore, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-4 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                  >
                    <div className="flex-1">
                      <p className="font-semibold text-zinc-900 dark:text-zinc-50">
                        {formatDomainName(domainScore.domain)}
                      </p>
                      <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                        {domainScore.correct} of {domainScore.total} correct
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
                        {domainScore.accuracy}%
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">Accuracy</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Navigation: Return to Dashboard */}
        <div className="flex justify-center">
          <Button
            onClick={handleReturnToDashboard}
            size="lg"
            className="w-full md:w-auto min-w-[200px]"
          >
            Return to Dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}
