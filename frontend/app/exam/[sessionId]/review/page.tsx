'use client';

import 'katex/dist/katex.min.css';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardContent, CardTitle } from '@/components/ui/card';
import api from '@/lib/api';
import ReviewQuestionDisplay from '@/src/components/review/ReviewQuestionDisplay';
import TutorConsole from '@/src/components/review/TutorConsole';
import { CheckCircle2, XCircle, ChevronLeft, ChevronRight } from 'lucide-react';

interface ReviewItem {
  item_id: string;
  question_text: string;
  user_selected_id: number;
  correct_option_id: number;
  is_correct: boolean;
  options: (number | string)[];
  is_spr?: boolean;
  correct_answer?: string;
  user_answer?: string;
  solution_text?: string | null;
  skill_tag?: string | null;
  time_spent?: number | null;
  ai_explanation?: string;
  distractor_analysis?: Record<string, string>;
  hint_sequence?: string[];
  stimulus?: string;
  domain?: string;
}

export default function ReviewPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.sessionId as string;

  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  // Retry mode: track student's retry answers for wrong questions
  const [retryMode, setRetryMode] = useState(false);
  const [retryAnswers, setRetryAnswers] = useState<Record<string, string>>({});
  const [retryChecked, setRetryChecked] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const fetchReview = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/sessions/${sessionId}/review`);
        if (!response.ok) throw new Error((await response.json()).detail || `Error ${response.status}`);
        const data = await response.json();
        setReviewItems(data);
        setError(null);
      } catch (err: any) {
        const errorMessage = err.response?.data?.detail || err.message || 'Failed to load review';
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    };

    if (sessionId) {
      fetchReview();
    }
  }, [sessionId]);

  // Keyboard navigation (Left/Right arrows)
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && selectedIndex > 0) {
        setSelectedIndex(selectedIndex - 1);
      } else if (e.key === 'ArrowRight' && selectedIndex < reviewItems.length - 1) {
        setSelectedIndex(selectedIndex + 1);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [selectedIndex, reviewItems.length]);

  const handleBackToResults = () => {
    router.push('/dashboard');
  };

  const selectedItem = reviewItems[selectedIndex] || null;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-lg">Loading Review...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Card className="w-full max-w-2xl">
          <CardHeader>
            <CardTitle>Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-red-600 dark:text-red-400">{error}</p>
            <Button onClick={handleBackToResults} className="mt-4">
              Back to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (reviewItems.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Card className="w-full max-w-2xl">
          <CardContent className="py-8 text-center text-zinc-500">
            No review items found.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-zinc-50 dark:bg-black overflow-hidden">
      {/* Top Navigation Bar */}
      <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
        <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
          {retryMode ? 'Retry Mode' : 'Exam Review'}
        </h1>
        <div className="flex items-center gap-3">
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            Question {selectedIndex + 1} of {retryMode ? reviewItems.filter(i => !i.is_correct).length : reviewItems.length}
          </div>
          {reviewItems.some(i => !i.is_correct) && (
            <Button
              onClick={() => {
                setRetryMode(!retryMode);
                setRetryAnswers({});
                setRetryChecked({});
                setSelectedIndex(0);
                if (!retryMode) {
                  // Jump to first wrong question
                  const firstWrong = reviewItems.findIndex(i => !i.is_correct);
                  if (firstWrong >= 0) setSelectedIndex(firstWrong);
                }
              }}
              variant={retryMode ? 'default' : 'outline'}
              size="sm"
            >
              {retryMode ? 'Exit Retry' : `Retry Wrong (${reviewItems.filter(i => !i.is_correct).length})`}
            </Button>
          )}
          <Button onClick={handleBackToResults} variant="outline" size="sm">
            Back to Dashboard
          </Button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar (Left - 250px) */}
        <div className="w-64 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-y-auto">
          <div className="p-4 space-y-2">
            <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-3">
              {retryMode ? 'Wrong Answers' : 'Questions'}
            </div>
            {(retryMode ? reviewItems.filter(i => !i.is_correct) : reviewItems).map((item, index) => {
              const globalIndex = retryMode ? reviewItems.findIndex(r => r.item_id === item.item_id) : index;
              const retryAnswer = retryAnswers[item.item_id];
              const retryIsChecked = retryChecked[item.item_id];
              const retryIsCorrect = retryIsChecked && retryAnswer === String(item.correct_answer ?? item.correct_option_id);
              return (
                <button
                  key={item.item_id}
                  onClick={() => setSelectedIndex(globalIndex)}
                  className={`w-full flex items-center justify-between p-3 rounded-lg transition-colors ${
                    globalIndex === selectedIndex
                      ? 'bg-blue-50 dark:bg-blue-900/20 border-2 border-blue-500 dark:border-blue-600'
                      : 'bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium ${
                      globalIndex === selectedIndex ? 'text-blue-700 dark:text-blue-300' : 'text-zinc-700 dark:text-zinc-300'
                    }`}>
                      {index + 1}
                    </span>
                    {retryMode ? (
                      retryIsChecked ? (
                        retryIsCorrect
                          ? <CheckCircle2 className="w-4 h-4 text-green-600" />
                          : <XCircle className="w-4 h-4 text-red-600" />
                      ) : (
                        <XCircle className="w-4 h-4 text-orange-400" />
                      )
                    ) : item.is_correct ? (
                      <CheckCircle2 data-testid="correct-icon" className="w-4 h-4 text-green-600 dark:text-green-400" />
                    ) : (
                      <XCircle data-testid="incorrect-icon" className="w-4 h-4 text-red-600 dark:text-red-400" />
                    )}
                  </div>
                  <Badge
                    variant={retryMode ? (retryIsChecked ? (retryIsCorrect ? 'default' : 'destructive') : 'outline') : (item.is_correct ? 'default' : 'destructive')}
                    className="text-xs"
                  >
                    {retryMode ? (retryIsChecked ? (retryIsCorrect ? '✓' : '✗') : '?') : (item.is_correct ? '✓' : '✗')}
                  </Badge>
                </button>
              );
            })}
          </div>
        </div>

        {/* Main Split Screen Area */}
        <div className="flex-1 flex overflow-hidden">
          {/* Mobile: Stack vertically */}
          <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
            {/* Left Pane (60% on desktop, full width on mobile) */}
            <div className="flex-1 md:flex-[0.6] overflow-hidden border-r border-zinc-200 dark:border-zinc-800">
              {selectedItem && (
                <div className="h-full flex flex-col">
                  {retryMode && !selectedItem.is_correct && (
                    <div className="p-3 border-b border-zinc-200 dark:border-zinc-800 bg-orange-50 dark:bg-orange-900/10">
                      <div className="flex flex-wrap gap-2 mb-2">
                        {(selectedItem.options || []).map((opt: any, idx: number) => {
                          const optId = typeof opt === 'object' ? String(opt.id ?? opt.letter ?? idx) : String(opt);
                          const optText = typeof opt === 'object' ? (opt.content || opt.text || String(opt)) : String(opt);
                          const isSelected = retryAnswers[selectedItem.item_id] === optId;
                          const isChecked = retryChecked[selectedItem.item_id];
                          const isCorrect = optId === String(selectedItem.correct_answer ?? selectedItem.correct_option_id);
                          let btnClass = 'px-3 py-1.5 rounded-lg text-sm border transition-colors ';
                          if (isChecked) {
                            if (isCorrect) btnClass += 'bg-green-100 border-green-500 text-green-800';
                            else if (isSelected) btnClass += 'bg-red-100 border-red-500 text-red-800';
                            else btnClass += 'bg-white dark:bg-zinc-900 border-zinc-300 text-zinc-600';
                          } else {
                            btnClass += isSelected
                              ? 'bg-blue-100 border-blue-500 text-blue-800'
                              : 'bg-white dark:bg-zinc-900 border-zinc-300 hover:border-blue-400 text-zinc-800 dark:text-zinc-200';
                          }
                          return (
                            <button
                              key={optId}
                              className={btnClass}
                              disabled={isChecked}
                              onClick={() => setRetryAnswers(prev => ({ ...prev, [selectedItem.item_id]: optId }))}
                            >
                              {optId}. {optText}
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          disabled={!retryAnswers[selectedItem.item_id] || retryChecked[selectedItem.item_id]}
                          onClick={() => setRetryChecked(prev => ({ ...prev, [selectedItem.item_id]: true }))}
                        >
                          Check Answer
                        </Button>
                        {retryChecked[selectedItem.item_id] && (
                          <span className={`text-sm font-semibold flex items-center gap-1 ${
                            retryAnswers[selectedItem.item_id] === String(selectedItem.correct_answer ?? selectedItem.correct_option_id)
                              ? 'text-green-600' : 'text-red-600'
                          }`}>
                            {retryAnswers[selectedItem.item_id] === String(selectedItem.correct_answer ?? selectedItem.correct_option_id)
                              ? '✓ Correct!' : '✗ Incorrect'}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                  <div className="flex-1 overflow-hidden">
                    <ReviewQuestionDisplay item={selectedItem} />
                  </div>
                </div>
              )}
            </div>

            {/* Right Pane (40% on desktop, full width on mobile) */}
            <div className="flex-1 md:flex-[0.4] overflow-hidden">
              {selectedItem && (
                <TutorConsole item={selectedItem} sessionId={sessionId} />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Navigation (Mobile-friendly) */}
      <div className="flex items-center justify-between p-4 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 md:hidden">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSelectedIndex(Math.max(0, selectedIndex - 1))}
          disabled={selectedIndex === 0}
        >
          <ChevronLeft className="w-4 h-4 mr-1" />
          Previous
        </Button>
        <span className="text-sm text-zinc-600 dark:text-zinc-400">
          {selectedIndex + 1} / {reviewItems.length}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSelectedIndex(Math.min(reviewItems.length - 1, selectedIndex + 1))}
          disabled={selectedIndex === reviewItems.length - 1}
        >
          Next
          <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}
