'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';

type QuestionBankItem = {
  id: string;
  question_text: string;
  context_type?: string | null;
  variables?: Record<string, any> | null;
};

const TOPIC_OPTIONS = ['Algebra', 'Geometry', 'Advanced Math'] as const;

export default function CreateExamQuestionPage() {
  const [items, setItems] = useState<QuestionBankItem[]>([]);
  const [loadingBank, setLoadingBank] = useState(true);

  const [isGenerateOpen, setIsGenerateOpen] = useState(false);
  const [generateTopic, setGenerateTopic] = useState<(typeof TOPIC_OPTIONS)[number]>('Algebra');
  const [generateDifficulty, setGenerateDifficulty] = useState(1.5);
  const [generateCount, setGenerateCount] = useState(5);
  const [generateLoading, setGenerateLoading] = useState(false);

  const [questionText, setQuestionText] = useState('');
  const [optionA, setOptionA] = useState('');
  const [optionB, setOptionB] = useState('');
  const [optionC, setOptionC] = useState('');
  const [optionD, setOptionD] = useState('');
  const [correctOption, setCorrectOption] = useState<'A' | 'B' | 'C' | 'D' | ''>('');
  const [manualDifficulty, setManualDifficulty] = useState(1.0);
  const [savingQuestion, setSavingQuestion] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchItems = async () => {
    try {
      setLoadingBank(true);
      const response = await api.get('/content/items');
      setItems(response.data);
    } catch (err: any) {
      console.error('Failed to load question bank:', err);
    } finally {
      setLoadingBank(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, []);

  const handleGenerateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);
    try {
      setGenerateLoading(true);
      await api.post('/content/generate', {
        topic: generateTopic,
        difficulty: generateDifficulty,
        count: generateCount,
      });
      setIsGenerateOpen(false);
      await fetchItems();
    } catch (err: any) {
      console.error('Failed to generate items:', err);
      setError(err.response?.data?.detail || err.message || 'Failed to generate questions');
    } finally {
      setGenerateLoading(false);
    }
  };

  const handleSaveQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (!questionText.trim()) {
      setError('Question text is required.');
      return;
    }

    const optionsValues = [optionA, optionB, optionC, optionD].map((value) => {
      const num = Number(value);
      return Number.isNaN(num) ? null : num;
    });

    if (optionsValues.some((v) => v === null)) {
      setError('All options must be numeric values.');
      return;
    }

    const indexMap: Record<'A' | 'B' | 'C' | 'D', number> = {
      A: 0,
      B: 1,
      C: 2,
      D: 3,
    };

    if (!correctOption) {
      setError('Please select the correct answer.');
      return;
    }

    const correctIndex = indexMap[correctOption];

    try {
      setSavingQuestion(true);
      await api.post('/content/items', {
        text: questionText,
        options: optionsValues,
        correct_id: correctIndex,
        difficulty: manualDifficulty,
        domain: 'manual',
      });
      setSuccessMessage('Question saved to Question Bank.');
      setQuestionText('');
      setOptionA('');
      setOptionB('');
      setOptionC('');
      setOptionD('');
      setCorrectOption('');
      await fetchItems();
    } catch (err: any) {
      console.error('Failed to save question:', err);
      setError(err.response?.data?.detail || err.message || 'Failed to save question');
    } finally {
      setSavingQuestion(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black text-zinc-900 dark:text-zinc-50">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-6">
        <header className="mb-6">
          <h1 className="text-3xl font-bold">Exam Item Studio</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Craft questions manually or let AI help you build your question bank.
          </p>
        </header>

        {error && (
          <div className="mb-4 rounded-md border border-red-500 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-600 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}
        {successMessage && (
          <div className="mb-4 rounded-md border border-emerald-500 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300">
            {successMessage}
          </div>
        )}

        <div className="flex flex-1 gap-6 overflow-hidden">
          {/* Sidebar - Question Bank */}
          <aside className="flex w-full max-w-xs flex-col rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-4 flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
                  Question Bank
                </h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {loadingBank ? 'Loading...' : `${items.length} items`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsGenerateOpen(true)}
                className="inline-flex items-center rounded-full bg-indigo-600 px-3 py-1 text-xs font-medium text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
                disabled={generateLoading}
              >
                <span className="mr-1">✨</span>
                Generate with AI
              </button>
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto rounded-md border border-dashed border-zinc-200 p-2 text-sm dark:border-zinc-700">
              {loadingBank ? (
                <div className="py-4 text-center text-xs text-zinc-500">Loading items…</div>
              ) : items.length === 0 ? (
                <div className="py-4 text-center text-xs text-zinc-500">
                  No items yet. Try generating a few with AI.
                </div>
              ) : (
                items.map((item) => (
                  <div
                    key={item.id}
                    className="cursor-default rounded-md border border-zinc-200 bg-zinc-50 p-2 text-xs leading-snug hover:border-indigo-400 hover:bg-indigo-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-indigo-500 dark:hover:bg-zinc-800"
                  >
                    <div className="mb-1 line-clamp-2 font-medium">
                      {item.question_text || 'Untitled question'}
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-zinc-500">
                      <span>{item.context_type || 'General'}</span>
                      {item.variables?.difficulty !== undefined && (
                        <span>Difficulty: {item.variables.difficulty}</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>

          {/* Main Area - Editor Canvas */}
          <main className="flex flex-1 flex-col rounded-lg border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="mb-4 text-lg font-semibold">Editor Canvas</h2>

            <form onSubmit={handleSaveQuestion} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium">Question Text</label>
                <textarea
                  className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none ring-0 placeholder:text-zinc-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                  rows={5}
                  value={questionText}
                  onChange={(e) => setQuestionText(e.target.value)}
                  placeholder="Write your question here. You can use LaTeX syntax if your renderer supports it."
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium">Option A</label>
                  <input
                    type="text"
                    value={optionA}
                    onChange={(e) => setOptionA(e.target.value)}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                    placeholder="Numeric value"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Option B</label>
                  <input
                    type="text"
                    value={optionB}
                    onChange={(e) => setOptionB(e.target.value)}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                    placeholder="Numeric value"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Option C</label>
                  <input
                    type="text"
                    value={optionC}
                    onChange={(e) => setOptionC(e.target.value)}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                    placeholder="Numeric value"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Option D</label>
                  <input
                    type="text"
                    value={optionD}
                    onChange={(e) => setOptionD(e.target.value)}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                    placeholder="Numeric value"
                  />
                </div>
              </div>

              <div>
                <span className="mb-1 block text-sm font-medium">Correct Answer</span>
                <div className="flex flex-wrap gap-4 text-sm">
                  {(['A', 'B', 'C', 'D'] as const).map((opt) => (
                    <label key={opt} className="inline-flex items-center gap-2">
                      <input
                        type="radio"
                        name="correct-option"
                        value={opt}
                        checked={correctOption === opt}
                        onChange={() => setCorrectOption(opt)}
                        className="h-4 w-4 border-zinc-400 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>{opt}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium">Difficulty</label>
                  <input
                    type="number"
                    step="0.1"
                    min={0}
                    max={3}
                    value={manualDifficulty}
                    onChange={(e) => setManualDifficulty(Number(e.target.value))}
                    className="w-28 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                  />
                </div>

                <button
                  type="submit"
                  disabled={savingQuestion}
                  className="inline-flex items-center rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  {savingQuestion ? 'Saving…' : 'Save Question'}
                </button>
              </div>
            </form>
          </main>
        </div>
      </div>

      {/* Magic Button Dialog */}
      {isGenerateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
            <h2 className="text-lg font-semibold">Generate Questions with AI</h2>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
              Choose a topic and difficulty, then let the generator create a small batch of items.
            </p>

            <form onSubmit={handleGenerateSubmit} className="mt-4 space-y-4 text-sm">
              <div>
                <label className="mb-1 block text-sm font-medium">Topic</label>
                <select
                  value={generateTopic}
                  onChange={(e) => setGenerateTopic(e.target.value as (typeof TOPIC_OPTIONS)[number])}
                  className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                >
                  {TOPIC_OPTIONS.map((topic) => (
                    <option key={topic} value={topic}>
                      {topic}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">
                  Difficulty ({generateDifficulty.toFixed(1)})
                </label>
                <input
                  type="range"
                  min={0}
                  max={3}
                  step={0.1}
                  value={generateDifficulty}
                  onChange={(e) => setGenerateDifficulty(Number(e.target.value))}
                  className="w-full"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">Count</label>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={generateCount}
                  onChange={(e) => setGenerateCount(Number(e.target.value))}
                  className="w-24 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                />
                <p className="mt-1 text-xs text-zinc-500">
                  The backend may cap this to 1–2 items per request for speed.
                </p>
              </div>

              <div className="mt-4 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsGenerateOpen(false)}
                  className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  disabled={generateLoading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={generateLoading}
                  className="inline-flex items-center rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
                >
                  {generateLoading ? 'Generating…' : 'Generate'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

