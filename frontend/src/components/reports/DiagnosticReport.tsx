'use client';

import React from 'react';

interface CategoryPerformance {
  total: number;
  correct: number;
}

interface DiagnosticReportProps {
  /** Performance breakdown by SAT category */
  categoryPerformance?: Record<string, CategoryPerformance>;
  /** Performance profile (same as categoryPerformance, for consistency) */
  performanceProfile?: Record<string, CategoryPerformance>;
  /** Final calculated score (200-800) */
  finalScore: number | null;
  /** Optional callback to review answers */
  onReviewAnswers?: () => void;
  /** Optional exam packet for difficulty analysis */
  examPacket?: any;
  /** Optional session answers for difficulty analysis */
  sessionAnswers?: Record<string, string>;
}

/**
 * DiagnosticReport Component
 * 
 * Displays the student's baseline diagnostic after completing an exam:
 * - Mastery bars for each SAT domain/category
 * - Predicted score
 * - Top 3 skills to improve
 */
export default function DiagnosticReport({
  categoryPerformance,
  performanceProfile,
  finalScore,
  onReviewAnswers,
  examPacket,
  sessionAnswers
}: DiagnosticReportProps) {
  
  // Use performanceProfile if available, fallback to categoryPerformance
  const perfData = performanceProfile || categoryPerformance;
  
  // Calculate mastery percentage for each category
  const categoryStats = perfData 
    ? Object.entries(perfData).map(([category, stats]) => {
        const percentage = stats.total > 0 
          ? Math.round((stats.correct / stats.total) * 100) 
          : 0;
        return {
          category,
          percentage,
          correct: stats.correct,
          total: stats.total
        };
      })
    : [];

  // Calculate difficulty distribution
  const difficultyStats = React.useMemo(() => {
    if (!examPacket || !sessionAnswers) return null;
    
    const stats = {
      easy: { total: 0, correct: 0 },
      medium: { total: 0, correct: 0 },
      hard: { total: 0, correct: 0 },
      veryHard: { total: 0, correct: 0 }
    };

    Object.entries(sessionAnswers).forEach(([questionId, studentAnswer]) => {
      const question = examPacket.content_bank?.[questionId];
      if (!question) return;

      const difficulty = question.difficulty_level || 2;
      const correctAnswer = question.correct_answer;
      const isCorrect = String(studentAnswer).toUpperCase().trim() === String(correctAnswer).toUpperCase().trim();

      if (difficulty === 1) {
        stats.easy.total++;
        if (isCorrect) stats.easy.correct++;
      } else if (difficulty === 2) {
        stats.medium.total++;
        if (isCorrect) stats.medium.correct++;
      } else if (difficulty === 3) {
        stats.hard.total++;
        if (isCorrect) stats.hard.correct++;
      } else if (difficulty === 4) {
        stats.veryHard.total++;
        if (isCorrect) stats.veryHard.correct++;
      }
    });

    return stats;
  }, [examPacket, sessionAnswers]);

  // Sort by percentage (lowest first) to find top skills to improve
  const sortedByPerformance = [...categoryStats].sort((a, b) => a.percentage - b.percentage);
  const topSkillsToImprove = sortedByPerformance.slice(0, 3);

  // Group categories by domain for better visualization
  const readingWritingCategories = [
    'Information and Ideas',
    'Craft and Structure',
    'Expression of Ideas',
    'Standard English Conventions'
  ];
  
  const mathCategories = [
    'Algebra',
    'Advanced Math',
    'Problem-Solving and Data Analysis',
    'Geometry and Trigonometry'
  ];

  const rwStats = categoryStats.filter(s => readingWritingCategories.includes(s.category));
  const mathStats = categoryStats.filter(s => mathCategories.includes(s.category));

  // Calculate domain-level mastery
  const rwMastery = rwStats.length > 0
    ? Math.round(rwStats.reduce((sum, s) => sum + s.percentage, 0) / rwStats.length)
    : 0;
  
  const mathMastery = mathStats.length > 0
    ? Math.round(mathStats.reduce((sum, s) => sum + s.percentage, 0) / mathStats.length)
    : 0;

  // Determine which section this is based on the data
  // If we have math stats, it's a math diagnostic; otherwise it's reading & writing
  const isMathSection = mathStats.length > 0;
  const sectionName = isMathSection ? 'Math Section' : 'Reading & Writing Section';

  return (
    <div className="w-full max-w-4xl mx-auto p-6 space-y-8">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Your Baseline Diagnostic</h1>
        <p className="text-gray-600">Understanding your strengths and areas for improvement</p>
      </div>

      {/* Scaled Score Display */}
      <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl p-8 text-white text-center shadow-lg">
        <div className="text-sm font-semibold uppercase tracking-wide mb-2 opacity-90">
          Estimated Scaled Score
        </div>
        <div className="text-7xl font-bold mb-2">
          {finalScore || 'N/A'}
        </div>
        <div className="text-lg opacity-90">
          {sectionName}
        </div>
        <div className="text-sm mt-4 opacity-75">
          Score Range: 200-800
        </div>
        <div className="text-xs mt-2 opacity-70 bg-white/10 rounded-lg px-4 py-2">
          ⚠️ This is a training estimate only, not an official SAT score prediction. Actual SAT scores depend on test conditions and College Board&apos;s official scoring.
        </div>
      </div>

      {/* Difficulty Distribution */}
      {difficultyStats && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-2xl font-bold text-gray-800 mb-4">Performance by Difficulty</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Easy', data: difficultyStats.easy, color: 'bg-green-500' },
              { label: 'Medium', data: difficultyStats.medium, color: 'bg-yellow-500' },
              { label: 'Hard', data: difficultyStats.hard, color: 'bg-orange-500' },
              { label: 'Very Hard', data: difficultyStats.veryHard, color: 'bg-red-500' }
            ].map(({ label, data, color }) => {
              const percentage = data.total > 0 ? Math.round((data.correct / data.total) * 100) : 0;
              return (
                <div key={label} className="border rounded-lg p-4">
                  <div className="text-sm font-semibold text-gray-700 mb-2">{label}</div>
                  <div className="text-2xl font-bold text-gray-800 mb-2">
                    {percentage}%
                  </div>
                  <div className="text-xs text-gray-500 mb-2">
                    {data.correct}/{data.total} correct
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className={`${color} h-2 rounded-full transition-all duration-500`}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Domain Mastery Bars */}
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">Domain Mastery</h2>
        
        {/* Reading and Writing Domain */}
        {rwStats.length > 0 && (
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold text-gray-800">Reading and Writing</h3>
              <span className="text-2xl font-bold text-indigo-600">{rwMastery}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-4 mb-4">
              <div 
                className="bg-indigo-600 h-4 rounded-full transition-all duration-500"
                style={{ width: `${rwMastery}%` }}
              />
            </div>
            <div className="grid grid-cols-2 gap-4 mt-4">
              {rwStats.map((stat) => (
                <div key={stat.category} className="border-l-4 border-indigo-400 pl-3">
                  <div className="text-sm font-medium text-gray-700">{stat.category}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {stat.correct}/{stat.total} correct ({stat.percentage}%)
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Math Domain */}
        {mathStats.length > 0 && (
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold text-gray-800">Math</h3>
              <span className="text-2xl font-bold text-green-600">{mathMastery}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-4 mb-4">
              <div 
                className="bg-green-600 h-4 rounded-full transition-all duration-500"
                style={{ width: `${mathMastery}%` }}
              />
            </div>
            <div className="grid grid-cols-2 gap-4 mt-4">
              {mathStats.map((stat) => (
                <div key={stat.category} className="border-l-4 border-green-400 pl-3">
                  <div className="text-sm font-medium text-gray-700">{stat.category}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {stat.correct}/{stat.total} correct ({stat.percentage}%)
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* All Categories (if not grouped) */}
        {rwStats.length === 0 && mathStats.length === 0 && categoryStats.length > 0 && (
          <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-xl font-semibold text-gray-800 mb-4">Category Performance</h3>
            <div className="space-y-4">
              {categoryStats.map((stat) => {
                const colorClass = stat.percentage >= 70 ? 'bg-green-600' : 
                                 stat.percentage >= 50 ? 'bg-yellow-500' : 'bg-red-500';
                return (
                  <div key={stat.category}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-700">{stat.category}</span>
                      <span className="text-sm font-semibold text-gray-800">
                        {stat.percentage}% ({stat.correct}/{stat.total})
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-3">
                      <div 
                        className={`${colorClass} h-3 rounded-full transition-all duration-500`}
                        style={{ width: `${stat.percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Top 3 Skills to Improve */}
      {topSkillsToImprove.length > 0 && (
        <div className="bg-amber-50 border-l-4 border-amber-400 rounded-lg p-6">
          <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center">
            <span className="mr-2">🎯</span>
            Top 3 Skills to Improve
          </h2>
          <ol className="space-y-3">
            {topSkillsToImprove.map((skill, index) => (
              <li key={skill.category} className="flex items-start">
                <span className="flex-shrink-0 w-8 h-8 bg-amber-400 text-white rounded-full flex items-center justify-center font-bold mr-3">
                  {index + 1}
                </span>
                <div className="flex-1">
                  <div className="font-semibold text-gray-800">{skill.category}</div>
                  <div className="text-sm text-gray-600 mt-1">
                    {skill.correct}/{skill.total} correct ({skill.percentage}% mastery)
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Focus on practice questions in this area to improve your score
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Empty State */}
      {(!categoryPerformance || Object.keys(categoryPerformance).length === 0) && (
        <div className="bg-gray-50 rounded-lg p-8 text-center">
          <p className="text-gray-600">
            Category performance data is not available. Complete more questions to see your diagnostic report.
          </p>
        </div>
      )}

      {/* Review Answers Button */}
      {onReviewAnswers && (
        <div className="mt-8 text-center">
          <button
            onClick={onReviewAnswers}
            className="px-8 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-lg transition-all font-semibold text-lg"
          >
            Review Answers with Socratic Help
          </button>
        </div>
      )}
    </div>
  );
}
