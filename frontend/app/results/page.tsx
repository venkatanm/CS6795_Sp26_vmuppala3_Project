'use client';

import { useEffect, useState, Suspense, useRef, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useExamStore } from '@/store/exam-store';
import api from '@/lib/api';
import { Card, CardHeader, CardContent, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface StudyPlanItem {
  topic?: string;
  mistakes?: number;  // Changed from 'count' to 'mistakes' to match API
  message: string;
}

function ResultsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { sessionId: storeSessionId } = useExamStore();
  const [score, setScore] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [studyPlan, setStudyPlan] = useState<StudyPlanItem[]>([]);
  const [studyPlanLoading, setStudyPlanLoading] = useState(false);
  const hasFetchedRef = useRef(false);
  const hasRedirectedRef = useRef(false);

  // Initialize sessionId once from store or URL params
  useEffect(() => {
    const urlSessionId = searchParams.get('sessionId');
    const finalSessionId = storeSessionId || urlSessionId;
    
    // If no sessionId at all, redirect immediately
    if (!finalSessionId && !hasRedirectedRef.current) {
      hasRedirectedRef.current = true;
      router.replace('/');
      return;
    }
    
    // Set sessionId if we have one and haven't set it yet
    if (finalSessionId && sessionId === null) {
      setSessionId(finalSessionId);
    }
  }, [storeSessionId, searchParams, sessionId, router]);

  useEffect(() => {
    // Wait for sessionId to be initialized or if we're redirecting
    if (sessionId === null || hasRedirectedRef.current) {
      return;
    }

    // Prevent multiple fetches
    if (hasFetchedRef.current) {
      setLoading(false);
      return;
    }

    // Mark as fetched before making the request
    hasFetchedRef.current = true;

    // Fetch session data
    const fetchSession = async () => {
      try {
        const response = await api.get(`/sessions/${sessionId}`);
        // Set score to student_theta
        setScore(response.data.student_theta || 0);
      } catch (err: any) {
        console.error('Failed to fetch session:', err);
        // On error, still show the page (score will be 0)
      } finally {
        setLoading(false);
      }
    };

    // Fetch study plan
    const fetchStudyPlan = async () => {
      try {
        setStudyPlanLoading(true);
        const response = await api.get(`/sessions/${sessionId}/study-plan`);
        setStudyPlan(response.data || []);
      } catch (err: any) {
        console.error('Failed to fetch study plan:', err);
        // On error, set empty plan
        setStudyPlan([]);
      } finally {
        setStudyPlanLoading(false);
      }
    };

    fetchSession();
    fetchStudyPlan();
  }, [sessionId]);

  const handleTakeAnotherTest = () => {
    router.push('/');
  };

  const handleReviewAnswers = () => {
    if (sessionId) {
      router.push(`/exam/${sessionId}/review`);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-lg">Loading Results...</div>
      </div>
    );
  }

  // Check if study plan is empty (only has success message)
  const hasWeaknesses = studyPlan.length > 0 && studyPlan.some(item => item.topic && item.mistakes);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black p-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <Card className="w-full">
          <CardHeader>
            <CardTitle className="text-center">Assessment Complete</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="text-center">
              <div className="text-5xl font-bold mb-2">
                {Math.round(score)}
              </div>
              <div className="text-lg text-zinc-600 dark:text-zinc-400">
                Your Ability Score
              </div>
            </div>
            
            <p className="text-sm text-center text-zinc-500 dark:text-zinc-500">
              This score was calculated using Item Response Theory (Elo Rating).
            </p>

            <div className="flex flex-col gap-3 justify-center">
              {sessionId && (
                <Button 
                  onClick={handleReviewAnswers} 
                  variant="outline" 
                  className="w-full md:w-auto"
                >
                  Review Your Answers
                </Button>
              )}
              <Button onClick={handleTakeAnotherTest} className="w-full md:w-auto">
                Take Another Test
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Personalized Lesson Plan Card */}
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Personalized Lesson Plan</CardTitle>
          </CardHeader>
          <CardContent>
            {studyPlanLoading ? (
              <div className="text-center py-4 text-zinc-500 dark:text-zinc-400">
                Loading study plan...
              </div>
            ) : !hasWeaknesses ? (
              <div className="text-center py-4">
                <div className="text-2xl mb-2">🎉</div>
                <p className="text-zinc-700 dark:text-zinc-300 font-medium">
                  Perfect Score! No specific weaknesses detected.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {studyPlan
                  .filter(item => item.topic && item.mistakes)
                  .map((item, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-4 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">🧠</span>
                        <div>
                          <p className="font-medium text-zinc-900 dark:text-zinc-50">
                            Weakness detected in {item.topic} ({item.mistakes} {item.mistakes === 1 ? 'mistake' : 'mistakes'}).
                          </p>
                          {item.message && (
                            <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                              {item.message}
                            </p>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          // Placeholder for now
                          console.log(`Start ${item.topic} Lesson`);
                        }}
                      >
                        Start {item.topic} Lesson
                      </Button>
                    </div>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function ResultsPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-lg">Loading Results...</div>
      </div>
    }>
      <ResultsContent />
    </Suspense>
  );
}
