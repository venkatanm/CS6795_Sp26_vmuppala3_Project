'use client';

import { useState, useEffect } from 'react';
import { examLoader, NetworkError } from '@/src/services/ExamLoader';
import { ExamPacket } from '@/src/types/ExamPacket';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
export default function TestExamLoaderPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExamPacket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [examId, setExamId] = useState('sat_rw_practice_001');
  const [isOnline, setIsOnline] = useState(true);
  const cachedExamCount = 0;

  const handleLoadTest = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      console.log('🧪 Testing ExamLoader with examId:', examId);
      const packet = await examLoader.loadExamForSession(examId);
      console.log('✅ ExamLoader result:', packet);
      setResult(packet);
    } catch (err) {
      console.error('❌ ExamLoader error:', err);
      
      if (err instanceof NetworkError) {
        setError(`Network Error: ${err.message}`);
      } else if (err instanceof Error) {
        setError(`Error: ${err.message}`);
      } else {
        setError(`Unknown error: ${String(err)}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClearCache = async () => {
    setResult(null);
    setError(null);
    alert('Cache cleared (exam content is no longer cached in IndexedDB)');
  };

  // Monitor connection status
  useEffect(() => {
    setIsOnline(navigator.onLine);

    const handleOnline = () => { setIsOnline(true); };
    const handleOffline = () => { setIsOnline(false); };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return (
    <div className="container mx-auto p-8 max-w-4xl">
      {/* Connection Status & Cache Indicator */}
      <div className="mb-4 p-4 bg-zinc-50 dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Connection Status:
              </span>
              <Badge
                variant={isOnline ? 'default' : 'destructive'}
                className={isOnline ? 'bg-green-500 hover:bg-green-600' : ''}
              >
                {isOnline ? '🟢 Online' : '🔴 Offline'}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Cached Exams:
              </span>
              <Badge variant="outline" className="text-sm">
                {cachedExamCount}
              </Badge>
            </div>
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            navigator.onLine: {String(navigator.onLine)}
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>ExamLoader Service Test</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="examId" className="text-sm font-medium">
              Exam ID:
            </label>
            <input
              id="examId"
              type="text"
              value={examId}
              onChange={(e) => setExamId(e.target.value)}
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-900"
              placeholder="Enter exam ID"
            />
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleLoadTest}
              disabled={loading || !examId}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {loading ? 'Loading...' : 'Load Test'}
            </Button>
            <Button
              onClick={handleClearCache}
              variant="outline"
              disabled={loading}
            >
              Clear Cache
            </Button>
          </div>

          {error && (
            <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
              <p className="text-red-800 dark:text-red-200 font-medium">Error:</p>
              <p className="text-red-600 dark:text-red-300">{error}</p>
            </div>
          )}

          {result && (
            <div className="space-y-4">
              <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md">
                <p className="text-green-800 dark:text-green-200 font-medium">✅ Success!</p>
                <p className="text-green-600 dark:text-green-300">
                  Exam packet loaded successfully. Check console for details.
                </p>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Exam Packet Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div>
                    <span className="font-medium">Exam ID:</span> {result.exam_id}
                  </div>
                  <div>
                    <span className="font-medium">Total Time:</span> {result.config.total_time}s
                  </div>
                  <div>
                    <span className="font-medium">Allowed Tools:</span>{' '}
                    {result.config.allowed_tools.length > 0
                      ? result.config.allowed_tools.join(', ')
                      : 'None'}
                  </div>
                  <div>
                    <span className="font-medium">Module 1 Threshold:</span>{' '}
                    {result.routing_logic.module_1_threshold}
                  </div>
                  <div>
                    <span className="font-medium">Modules:</span> {result.modules.length}
                    <ul className="list-disc list-inside ml-4 mt-1">
                      {result.modules.map((module) => (
                        <li key={module.id}>
                          {module.id} ({module.type}) - {module.question_order.length} questions
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <span className="font-medium">Content Bank:</span>{' '}
                    {Object.keys(result.content_bank).length} questions
                  </div>
                </CardContent>
              </Card>

              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium text-zinc-600 dark:text-zinc-400">
                  View Full JSON (click to expand)
                </summary>
                <pre className="mt-2 p-4 bg-zinc-100 dark:bg-zinc-900 rounded-md overflow-auto text-xs">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </details>
            </div>
          )}

          <div className="mt-6 p-4 bg-zinc-50 dark:bg-zinc-900 rounded-md">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              <strong>Test Instructions:</strong>
            </p>
            <ol className="list-decimal list-inside mt-2 space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
              <li>Click "Load Test" to load an exam packet</li>
              <li>First load will fetch from API/mock and cache to IndexedDB</li>
              <li>Second load should show "⚡️ Loaded from Cache" in console</li>
              <li>Click "Clear Cache" to remove cached data and test fresh fetch</li>
              <li>Check browser console for detailed logs</li>
            </ol>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
