'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Plus, Trash2, ArrowLeft, Sparkles, FileText, BookOpen } from 'lucide-react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import MathText from '@/components/exam/MathText';
import AdminGuard from '@/components/admin/AdminGuard';

type QuestionBankItem = {
  id: string;
  question_text: string;
  context_type?: string | null;
  variables?: Record<string, any> | null;
};

const TOPIC_OPTIONS = ['Algebra', 'Geometry', 'Advanced Math'] as const;

function CreateExamQuestionPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const examIdFromUrl = searchParams.get('examId');
  
  const [availableItems, setAvailableItems] = useState<QuestionBankItem[]>([]);
  const [examItems, setExamItems] = useState<QuestionBankItem[]>([]);
  const [currentExamId, setCurrentExamId] = useState<string | null>(examIdFromUrl);
  const [currentExamTitle, setCurrentExamTitle] = useState<string | null>(null);
  const [loadingBank, setLoadingBank] = useState(true);
  const [isCreateExamOpen, setIsCreateExamOpen] = useState(false);
  const [newExamTitle, setNewExamTitle] = useState('');
  const [creatingExam, setCreatingExam] = useState(false);

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
  const [showManualForm, setShowManualForm] = useState(false);
  

  const fetchItems = async () => {
    try {
      setLoadingBank(true);
      setError(null);
      const response = await api.get('/content/items');
      setAvailableItems(response.data);
    } catch (err: any) {
      console.error('Failed to load question bank:', err);
      const errorMessage = err.response?.data?.detail || err.message || 'Failed to load question bank. Make sure the backend server is running.';
      setError(errorMessage);
      setAvailableItems([]); // Clear items on error
    } finally {
      setLoadingBank(false);
    }
  };

  const fetchExamItems = async () => {
    if (!currentExamId) return;
    
    try {
      const response = await api.get(`/exams/${currentExamId}`);
      console.log('Exam structure:', response.data.structure);
      const structure = response.data.structure || {};
      
      // Extract items from the exam structure recursively
      const extractItems = async (container: any): Promise<QuestionBankItem[]> => {
        const items: QuestionBankItem[] = [];
        
        if (container.items && Array.isArray(container.items)) {
          for (const itemRef of container.items) {
            const itemId = typeof itemRef === 'string' ? itemRef : itemRef.item_id;
            // Find the item in availableItems
            let fullItem = availableItems.find(item => item.id === itemId);
            
            if (!fullItem) {
              // If item not in availableItems, create a minimal placeholder
              // This can happen if the item was just added but availableItems hasn't refreshed
              console.warn(`Item ${itemId} not found in availableItems, creating placeholder`);
              fullItem = {
                id: itemId,
                question_text: `Item ${itemId.substring(0, 8)}...`,
                context_type: null,
                variables: null
              };
            }
            
            if (fullItem) {
              items.push(fullItem);
            }
          }
        }
        
        if (container.children && Array.isArray(container.children)) {
          for (const child of container.children) {
            const childItems = await extractItems(child);
            items.push(...childItems);
          }
        }
        
        return items;
      };
      
      const extractedItems = await extractItems(structure);
      console.log('Extracted items:', extractedItems);
      setExamItems(extractedItems);
    } catch (err: any) {
      console.error('Failed to load exam items:', err);
      // If exam doesn't exist yet, that's okay - examItems will be empty
      setExamItems([]);
    }
  };

  const handleAddItemToExam = async (itemId: string) => {
    if (!currentExamId) {
      setError('Please create or select an exam first.');
      return;
    }

    try {
      // Find item in availableItems, or fetch it if not found
      let itemToAdd = availableItems.find(item => item.id === itemId);
      
      // If item not found, try to fetch it from the API
      if (!itemToAdd) {
        try {
          const itemResponse = await api.get(`/content/items/${itemId}`);
          itemToAdd = itemResponse.data;
          // Add to availableItems for future reference
          if (itemToAdd) {
            setAvailableItems(prev => {
              if (prev.some(item => item.id === itemId)) {
                return prev;
              }
              return [...prev, itemToAdd!];
            });
          }
        } catch (fetchErr) {
          console.warn(`Could not fetch item ${itemId} details:`, fetchErr);
          // Continue anyway - we'll add it with minimal info
        }
      }

      // Optimistic UI: immediately add to examItems if we have the item data
      if (itemToAdd) {
        setExamItems(prev => {
          // Check if item already exists to avoid duplicates
          if (prev.some(item => item.id === itemId)) {
            return prev;
          }
          return [...prev, itemToAdd!];
        });
      }

      // Call the API to add item to exam
      const response = await api.post(`/exams/${currentExamId}/items`, { item_id: itemId });
      console.log('Add item response:', response.data);
      
      // Refresh availableItems in case the item was just generated
      await fetchItems();
      
      // Refresh exam items to ensure consistency
      await fetchExamItems();
      
      // Don't show success message here - let the caller handle it
    } catch (err: any) {
      console.error('Failed to add item to exam:', err);
      const errorMessage = err.response?.data?.detail || err.message || 'Failed to add item to exam';
      setError(errorMessage);
      
      // Revert optimistic update on error
      setExamItems(prev => prev.filter(item => item.id !== itemId));
      throw err; // Re-throw so caller knows it failed
    }
  };

  const handleRemoveItemFromExam = async (itemId: string) => {
    if (!currentExamId) {
      setError('No exam selected.');
      return;
    }

    try {
      // Optimistic UI: immediately remove from examItems
      setExamItems(prev => prev.filter(item => item.id !== itemId));

      // Call the API
      await api.delete(`/exams/${currentExamId}/items/${itemId}`);
      
      // Refresh exam items to ensure consistency
      await fetchExamItems();
    } catch (err: any) {
      console.error('Failed to remove item from exam:', err);
      setError(err.response?.data?.detail || err.message || 'Failed to remove item from exam');
      
      // Revert optimistic update on error - re-add the item
      const itemToRestore = availableItems.find(item => item.id === itemId);
      if (itemToRestore) {
        setExamItems(prev => [...prev, itemToRestore]);
      }
    }
  };

  useEffect(() => {
    fetchItems();
  }, []);

  useEffect(() => {
    if (currentExamId && availableItems.length > 0) {
      fetchExamItems();
      // Also fetch exam title
      fetchExamTitle();
    }
  }, [currentExamId, availableItems.length]);

  const fetchExamTitle = async () => {
    if (!currentExamId) return;
    
    try {
      const response = await api.get(`/exams/${currentExamId}`);
      setCurrentExamTitle(response.data.title || null);
    } catch (err) {
      console.error('Failed to fetch exam title:', err);
      setCurrentExamTitle(null);
    }
  };

  const handleCreateExam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newExamTitle.trim()) {
      setError('Exam title is required.');
      return;
    }

    try {
      setCreatingExam(true);
      setError(null);
      
      // Create a minimal exam structure
      const examStructure = {
        id: 'root',
        type: 'test',
        flow_strategy: 'linear',
        children: [],
        items: [],
        routing_rules: [],
        metadata: {
          duration_seconds: 3600
        }
      };

      const response = await api.post('/exams', {
        title: newExamTitle.trim(),
        structure: examStructure,
        duration_seconds: 3600
      });

      const newExamId = response.data.id;
      const examTitle = newExamTitle.trim();
      setCurrentExamId(newExamId);
      setCurrentExamTitle(examTitle);
      setIsCreateExamOpen(false);
      setNewExamTitle('');
      setSuccessMessage(`Exam "${examTitle}" created successfully!`);
      
      // Update URL without reload
      const url = new URL(window.location.href);
      url.searchParams.set('examId', newExamId);
      window.history.pushState({}, '', url);
    } catch (err: any) {
      console.error('Failed to create exam:', err);
      setError(err.response?.data?.detail || err.message || 'Failed to create exam');
    } finally {
      setCreatingExam(false);
    }
  };

  const handleGenerateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);
    try {
      setGenerateLoading(true);
      const response = await api.post('/content/generate', {
        topic: generateTopic,
        difficulty: generateDifficulty,
        count: generateCount,
      });
      
      setIsGenerateOpen(false);
      
      const generatedItemIds = response.data?.item_ids || [];
      
      // Refresh items first to ensure they're in availableItems
      await fetchItems();
      
      // Wait a moment for state to update
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Auto-add generated items to the exam if currentExamId exists
      if (currentExamId && generatedItemIds.length > 0) {
        let addedCount = 0;
        for (const itemId of generatedItemIds) {
          try {
            await handleAddItemToExam(itemId);
            addedCount++;
          } catch (err) {
            console.error(`Failed to auto-add item ${itemId} to exam:`, err);
            // Continue with other items even if one fails
          }
        }
        if (addedCount > 0) {
          setSuccessMessage(`Successfully generated and added ${addedCount} question(s) to exam!`);
        } else {
          setSuccessMessage(`Successfully generated ${generatedItemIds.length} question(s)!`);
        }
      } else if (generatedItemIds.length > 0) {
        // If no exam selected, suggest creating one
        setSuccessMessage(`Generated ${generatedItemIds.length} question(s)! Create an exam to add them.`);
      } else {
        setSuccessMessage(`Successfully generated ${generatedItemIds.length} question(s)!`);
      }
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
          <div className="flex items-center gap-4 mb-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push('/admin')}
              className="text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Admin
            </Button>
          </div>
          <h1 className="text-3xl font-bold">Question Studio</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Create questions manually or use AI to generate questions for your question bank.
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

        {/* Creation Methods Section */}
        <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* AI Generation Card */}
          <Card className="border-2 border-indigo-200 dark:border-indigo-800">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                <CardTitle className="text-lg">Generate with AI</CardTitle>
              </div>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                Let AI create diverse questions for your question bank
              </p>
            </CardHeader>
            <CardContent>
              <Button
                onClick={() => setIsGenerateOpen(true)}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white"
                disabled={generateLoading}
              >
                <Sparkles className="h-4 w-4 mr-2" />
                {generateLoading ? 'Generating...' : 'Generate Questions'}
              </Button>
            </CardContent>
          </Card>

          {/* Manual Creation Card */}
          <Card className="border-2 border-zinc-200 dark:border-zinc-800">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-zinc-600 dark:text-zinc-400" />
                <CardTitle className="text-lg">Create Manually</CardTitle>
              </div>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                Write your own questions with full control
              </p>
            </CardHeader>
            <CardContent>
              <Button
                onClick={() => setShowManualForm(!showManualForm)}
                variant="outline"
                className="w-full"
              >
                <FileText className="h-4 w-4 mr-2" />
                {showManualForm ? 'Hide Form' : 'Show Form'}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Manual Creation Form - Collapsible */}
        {showManualForm && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-lg">Create Question Manually</CardTitle>
            </CardHeader>
            <CardContent>
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
            </CardContent>
          </Card>
        )}

        {/* Main Content Area - Two Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column - Question Bank */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <BookOpen className="h-5 w-5" />
                    Question Bank
                  </CardTitle>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                    {loadingBank ? 'Loading...' : `${availableItems.length} questions`}
                  </p>
                </div>
                {availableItems.length > 0 && (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={async () => {
                      if (!confirm(`Are you sure you want to delete all ${availableItems.length} items from the question bank? This action cannot be undone.`)) {
                        return;
                      }
                      try {
                        setError(null);
                        setSuccessMessage(null);
                        await api.delete('/content/items');
                        setSuccessMessage(`Successfully deleted all ${availableItems.length} items from the question bank.`);
                        await fetchItems();
                      } catch (err: any) {
                        console.error('Failed to delete items:', err);
                        setError(err.response?.data?.detail || err.message || 'Failed to delete items');
                      }
                    }}
                    title="Clear all items"
                  >
                    Clear All
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {loadingBank ? (
                  <div className="py-8 text-center text-sm text-zinc-500">Loading items…</div>
                ) : error && availableItems.length === 0 ? (
                  <div className="py-8 text-center text-sm text-red-600 dark:text-red-400 px-2">
                    Error loading items. Check that the backend server is running at http://localhost:8000
                  </div>
                ) : availableItems.length === 0 ? (
                  <div className="py-8 text-center text-sm text-zinc-500">
                    No items yet. Generate questions with AI or create them manually.
                  </div>
                ) : (
                  availableItems.map((item) => {
                    const isInExam = examItems.some(examItem => examItem.id === item.id);
                    return (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm leading-snug hover:border-indigo-400 hover:bg-indigo-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-indigo-500 dark:hover:bg-zinc-800"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="mb-1 line-clamp-2 font-medium">
                            <MathText>{item.question_text || 'Untitled question'}</MathText>
                          </div>
                          <div className="flex items-center justify-between text-xs text-zinc-500">
                            <span>{item.context_type || 'General'}</span>
                            {item.variables?.difficulty !== undefined && (
                              <span>Difficulty: {item.variables.difficulty}</span>
                            )}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant={isInExam ? "secondary" : "default"}
                          onClick={() => {
                            if (!currentExamId) {
                              setIsCreateExamOpen(true);
                              setError('Please create an exam first to add questions.');
                              return;
                            }
                            if (!isInExam) {
                              handleAddItemToExam(item.id);
                            }
                          }}
                          disabled={isInExam}
                          className="flex-shrink-0"
                          title={isInExam ? "Already in exam" : currentExamId ? "Add to exam" : "Create exam first"}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>

          {/* Right Column - Exam Builder */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <BookOpen className="h-5 w-5" />
                  Exam Builder
                </CardTitle>
                {currentExamId && (
                  <Button
                    onClick={() => {
                      setCurrentExamId(null);
                      setCurrentExamTitle(null);
                      setExamItems([]);
                      const url = new URL(window.location.href);
                      url.searchParams.delete('examId');
                      window.history.pushState({}, '', url);
                    }}
                    variant="outline"
                    size="sm"
                  >
                    Clear Exam
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {!currentExamId ? (
                <div className="py-8 text-center">
                  <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
                    No exam selected
                  </p>
                  <Button
                    onClick={() => setIsCreateExamOpen(true)}
                    variant="default"
                  >
                    Create New Exam
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-950/20">
                    <p className="text-sm font-medium text-green-800 dark:text-green-200">
                      ✓ Active Exam: {currentExamTitle || currentExamId.substring(0, 8) + '...'}
                    </p>
                    <p className="text-xs text-green-700 dark:text-green-300 mt-1">
                      {examItems.length} question{examItems.length !== 1 ? 's' : ''} in this exam
                    </p>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold mb-2">Questions in This Exam ({examItems.length})</h3>
                    {examItems.length === 0 ? (
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 py-4 text-center">
                        No questions added yet. Add questions from the Question Bank.
                      </p>
                    ) : (
                      <div className="space-y-2 max-h-[500px] overflow-y-auto">
                        {examItems.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="mb-1 line-clamp-2 font-medium">
                                <MathText>{item.question_text || 'Untitled question'}</MathText>
                              </div>
                              <div className="text-xs text-zinc-500">
                                {item.context_type || 'General'}
                              </div>
                            </div>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => handleRemoveItemFromExam(item.id)}
                              className="flex-shrink-0"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
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

      {/* Create Exam Dialog */}
      {isCreateExamOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
            <h2 className="text-lg font-semibold">Create New Exam</h2>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
              Create a new exam to start adding questions from your question bank.
            </p>

            <form onSubmit={handleCreateExam} className="mt-4 space-y-4 text-sm">
              <div>
                <label className="mb-1 block text-sm font-medium">Exam Title</label>
                <input
                  type="text"
                  value={newExamTitle}
                  onChange={(e) => setNewExamTitle(e.target.value)}
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                  placeholder="e.g., SAT Math Practice Test 1"
                  autoFocus
                />
              </div>

              <div className="mt-4 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setIsCreateExamOpen(false);
                    setNewExamTitle('');
                  }}
                  className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  disabled={creatingExam}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingExam || !newExamTitle.trim()}
                  className="inline-flex items-center rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
                >
                  {creatingExam ? 'Creating...' : 'Create Exam'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CreateExamQuestionPage() {
  return (
    <AdminGuard>
      <Suspense fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-lg">Loading...</div>
        </div>
      }>
        <CreateExamQuestionPageContent />
      </Suspense>
    </AdminGuard>
  );
}
