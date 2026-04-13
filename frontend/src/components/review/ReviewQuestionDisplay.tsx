'use client';

import MathRenderer from '@/src/components/math/MathRenderer';
import { processMathMLInHTML } from '@/src/utils/mathmlToLatex';

/**
 * Renders HTML content (passage, etc.) preserving structure like tables.
 * Uses dangerouslySetInnerHTML for rich HTML that may contain tables.
 */
function HtmlContent({ html, className = '' }: { html: string; className?: string }) {
  if (!html) return null;
  return (
    <div
      className={`prose prose-lg max-w-none dark:prose-invert [&_table]:border [&_table]:border-collapse [&_td]:border [&_th]:border [&_td]:p-2 [&_th]:p-2 [&_th]:bg-zinc-100 [&_th]:dark:bg-zinc-800 ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}


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
  
  // AI-generated fields
  ai_explanation?: string;
  distractor_analysis?: Record<string, string>;
  hint_sequence?: string[];
  stimulus?: string;
  domain?: string;
}

interface ReviewQuestionDisplayProps {
  item: ReviewItem;
}

/**
 * ReviewQuestionDisplay Component
 * 
 * Renders the "Exam View" of the question on the left side of the split screen.
 * Clean, minimal styling without Card wrapper - designed for split pane layout.
 */
export default function ReviewQuestionDisplay({ item }: ReviewQuestionDisplayProps) {
  return (
    <div className="h-full overflow-y-auto p-6 bg-white dark:bg-zinc-950">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Passage Section (for Reading & Writing questions) - matches ExamRunner: raw HTML preserves tables */}
        {item.stimulus && (
          <div className="space-y-2">
            <div className="text-sm font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wide">
              Passage
            </div>
            <div className="text-base text-zinc-900 dark:text-zinc-50 leading-relaxed">
              <HtmlContent html={item.stimulus} />
            </div>
          </div>
        )}

        {/* Question Stem - matches ExamRunner: process MathML for proper rendering */}
        <div className="space-y-2">
          <div className="text-sm font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wide">
            Question
          </div>
          <div className="text-base text-zinc-900 dark:text-zinc-50 leading-relaxed prose prose-sm max-w-none dark:prose-invert [&_table]:border [&_table]:border-collapse [&_td]:border [&_th]:border [&_td]:p-2 [&_th]:p-2 [&_p]:mb-2">
            <MathRenderer allowHtml>{processMathMLInHTML(item.question_text || '')}</MathRenderer>
          </div>
        </div>

        {/* Options Section */}
        <div className="space-y-3">
          <div className="text-sm font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wide">
            Answer Choices
          </div>
          <div className="space-y-2">
            {item.options && item.options.length > 0 ? item.options.map((option, optionIndex) => {
              // Determine styling: use optionIndex for comparison when options are choice texts
              const isCorrect = optionIndex === item.correct_option_id;
              const isUserSelected = optionIndex === item.user_selected_id;
              const isWrongSelection = isUserSelected && !item.is_correct;
              
              let bgClass = 'bg-white dark:bg-zinc-900';
              let borderClass = 'border-zinc-200 dark:border-zinc-700';
              
              if (isCorrect) {
                // Always show the right answer in green
                bgClass = 'bg-green-50 dark:bg-green-900/20';
                borderClass = 'border-green-400 dark:border-green-600';
              } else if (isWrongSelection) {
                // Show their mistake in red
                bgClass = 'bg-red-50 dark:bg-red-900/20';
                borderClass = 'border-red-400 dark:border-red-600';
              }
              
              const optionLabel = String.fromCharCode(65 + optionIndex);
              return (
                <div
                  key={optionIndex}
                  className={`p-3 rounded border-2 ${bgClass} ${borderClass} transition-colors`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-zinc-600 dark:text-zinc-400 shrink-0">
                      {optionLabel}.
                    </span>
                    <span className="text-zinc-900 dark:text-zinc-50 text-base flex-1">
                      <MathRenderer allowHtml>{processMathMLInHTML(String(option))}</MathRenderer>
                    </span>
                    {isCorrect && (
                      <span className="text-xs text-green-700 dark:text-green-400 font-medium">
                        ✓ Correct Answer
                      </span>
                    )}
                    {isWrongSelection && (
                      <span className="text-xs text-red-700 dark:text-red-400 font-medium">
                        ✗ Your Selection
                      </span>
                    )}
                  </div>
                </div>
              );
            }) : item.is_spr ? (
              <div className="space-y-2 p-3 rounded-lg bg-zinc-100 dark:bg-zinc-800/50">
                <p className="text-sm text-zinc-600 dark:text-zinc-400">Grid-in (student-produced response)</p>
                {item.user_answer != null && item.user_answer !== '' && (
                  <p className="text-sm">
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">Your answer:</span>{' '}
                    <MathRenderer>{processMathMLInHTML(String(item.user_answer))}</MathRenderer>
                  </p>
                )}
                {item.correct_answer != null && item.correct_answer !== '' && (
                  <p className="text-sm">
                    <span className="font-medium text-green-700 dark:text-green-400">Correct answer:</span>{' '}
                    <MathRenderer>{processMathMLInHTML(String(item.correct_answer))}</MathRenderer>
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-zinc-500 dark:text-zinc-400 italic">No answer choices</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
