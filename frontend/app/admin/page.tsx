'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import api from '@/lib/api';
import AdminGuard from '@/components/admin/AdminGuard';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { BarChart3, Users, Target, FileQuestion, Trash2, BookOpen, Settings, GraduationCap, Home } from 'lucide-react';

interface Session {
  id: string;
  user_id: string;
  status: string;
  score: number | null;
  created_at: string;
  time_taken: number | null;
}

interface Analytics {
  score_distribution: Array<{ range: string; count: number }>;
  hardest_items: Array<{
    item_id: string;
    total_attempts: number;
    correct_count: number;
    pass_rate: number;
    question_text_snippet: string;
  }>;
}

interface ExamStat {
  id: string;
  title: string;
  is_active: boolean;
  total_attempts: number;
  completed_attempts: number;
  average_score: number | null;
  num_questions: number;
}

function AdminPageContent() {
  const router = useRouter();
  const { user } = useUser();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [examStats, setExamStats] = useState<ExamStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingExams, setLoadingExams] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'exams' | 'sessions'>('overview');

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [sessionsResponse, analyticsResponse] = await Promise.all([
          api.get('/admin/sessions'),
          api.get('/admin/analytics')
        ]);
        setSessions(sessionsResponse.data);
        setAnalytics(analyticsResponse.data);
        setError(null);
      } catch (err: any) {
        console.error('Failed to fetch data:', err);
        setError(err.response?.data?.detail || err.message || 'Failed to load data');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    fetchExamStatistics();
  }, []);

  const fetchExamStatistics = async () => {
    try {
      setLoadingExams(true);
      const response = await api.get('/exams/statistics');
      setExamStats(response.data || []);
    } catch (err: any) {
      console.error('Failed to fetch exam statistics:', err);
    } finally {
      setLoadingExams(false);
    }
  };

  const handleDeleteExam = async (examId: string, examTitle: string) => {
    if (!confirm(`Are you sure you want to delete the exam "${examTitle}"? This action cannot be undone.`)) {
      return;
    }
    try {
      await api.delete(`/exams/${examId}`);
      await fetchExamStatistics();
    } catch (err: any) {
      console.error('Failed to delete exam:', err);
      alert(err.response?.data?.detail || err.message || 'Failed to delete exam');
    }
  };

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateString;
    }
  };

  const handleViewDetails = (sessionId: string) => {
    router.push(`/exam/${sessionId}/review`);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-lg">Loading sessions...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-red-600 dark:text-red-400">{error}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black p-4">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-black dark:text-zinc-50">
              Admin Dashboard
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Manage exams, view analytics, and track student performance
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => router.push('/')}
              variant="outline"
              className="border-zinc-300 dark:border-zinc-700"
            >
              <GraduationCap className="h-4 w-4 mr-2" />
              Take Exam
            </Button>
            <Button
              onClick={() => router.push('/admin/exams/create')}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              <BookOpen className="h-4 w-4 mr-2" />
              Question Studio
            </Button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="border-b border-zinc-200 dark:border-zinc-800">
          <nav className="flex space-x-8">
            <button
              onClick={() => setActiveTab('overview')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'overview'
                  ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                  : 'border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-300 dark:text-zinc-400 dark:hover:text-zinc-300'
              }`}
            >
              Overview
            </button>
            <button
              onClick={() => setActiveTab('exams')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'exams'
                  ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                  : 'border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-300 dark:text-zinc-400 dark:hover:text-zinc-300'
              }`}
            >
              Exams ({examStats.length})
            </button>
            <button
              onClick={() => setActiveTab('sessions')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'sessions'
                  ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                  : 'border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-300 dark:text-zinc-400 dark:hover:text-zinc-300'
              }`}
            >
              Sessions ({sessions.length})
            </button>
          </nav>
        </div>

        {/* Tab Content */}
        {activeTab === 'overview' && (
          <>
            {/* Analytics Grid */}
            {analytics && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Score Distribution */}
                <Card>
                  <CardHeader>
                    <CardTitle>Score Distribution</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={analytics.score_distribution}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="range" />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="count" fill="#8884d8" />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {/* Hardest Questions */}
                <Card>
                  <CardHeader>
                    <CardTitle>Top 5 Hardest Questions</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {analytics.hardest_items.map((item) => {
                        const passRatePercent = Math.round(item.pass_rate * 100);
                        const badgeColor =
                          passRatePercent < 30
                            ? 'bg-red-500 hover:bg-red-600 text-white'
                            : passRatePercent < 50
                            ? 'bg-yellow-500 hover:bg-yellow-600 text-white'
                            : 'bg-green-500 hover:bg-green-600 text-white';
                        
                        return (
                          <div key={item.item_id} className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <p className="text-sm text-zinc-700 dark:text-zinc-300">
                                {item.question_text_snippet.length > 50
                                  ? `${item.question_text_snippet.substring(0, 50)}...`
                                  : item.question_text_snippet}
                              </p>
                            </div>
                            <Badge className={badgeColor}>
                              {passRatePercent}% Pass
                            </Badge>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Quick Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                    Total Exams
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{examStats.length}</div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                    {examStats.filter(e => e.is_active).length} active
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                    Total Sessions
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{sessions.length}</div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                    {sessions.filter(s => s.status === 'completed').length} completed
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                    Average Score
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {sessions.filter(s => s.score !== null).length > 0
                      ? Math.round(
                          sessions
                            .filter(s => s.score !== null)
                            .reduce((sum, s) => sum + (s.score || 0), 0) /
                            sessions.filter(s => s.score !== null).length
                        )
                      : 'N/A'}
                  </div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                    Across all completed sessions
                  </p>
                </CardContent>
              </Card>
            </div>
          </>
        )}

        {activeTab === 'exams' && (
          <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            {loadingExams ? (
              <div className="p-8 text-center text-zinc-600 dark:text-zinc-400">
                Loading exam statistics...
              </div>
            ) : examStats.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-zinc-600 dark:text-zinc-400 mb-4">No exams found.</p>
                <Button
                  onClick={() => router.push('/admin/exams/create')}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  Create Your First Exam
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-zinc-100 dark:bg-zinc-800">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
                        Exam Title
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
                        <FileQuestion className="h-4 w-4 mx-auto" />
                        Questions
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
                        <Users className="h-4 w-4 mx-auto" />
                        Total Attempts
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
                        Completed
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
                        <Target className="h-4 w-4 mx-auto" />
                        Avg Score
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
                        Status
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {examStats.map((exam) => (
                      <tr
                        key={exam.id}
                        className="hover:bg-zinc-50 dark:hover:bg-zinc-950/50"
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium text-sm">{exam.title}</div>
                          <div className="text-xs text-zinc-500 dark:text-zinc-400">
                            {exam.id.substring(0, 8)}...
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center text-sm">
                          {exam.num_questions}
                        </td>
                        <td className="px-4 py-3 text-center text-sm">
                          {exam.total_attempts}
                        </td>
                        <td className="px-4 py-3 text-center text-sm">
                          {exam.completed_attempts}
                        </td>
                        <td className="px-4 py-3 text-center text-sm">
                          {exam.average_score !== null ? (
                            <span className="font-semibold">{exam.average_score}</span>
                          ) : (
                            <span className="text-zinc-400 dark:text-zinc-600">N/A</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                              exam.is_active
                                ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                                : 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300'
                            }`}
                          >
                            {exam.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => router.push(`/admin/exams/create?examId=${exam.id}`)}
                            >
                              Edit
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => handleDeleteExam(exam.id, exam.title)}
                              className="bg-red-600 hover:bg-red-700 text-white"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'sessions' && (
          <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            {sessions.length === 0 ? (
              <div className="text-center py-12 text-zinc-600 dark:text-zinc-400">
                No sessions recorded yet
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.map((session) => (
                    <TableRow key={session.id}>
                      <TableCell className="font-medium">
                        {session.user_id}
                      </TableCell>
                      <TableCell>
                        {formatDate(session.created_at)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={session.status === 'completed' ? 'default' : 'secondary'}
                          className={
                            session.status === 'completed'
                              ? 'bg-green-500 hover:bg-green-600 text-white'
                              : 'bg-blue-500 hover:bg-blue-600 text-white'
                          }
                        >
                          {session.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {session.score !== null ? Math.round(session.score) : 'N/A'}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleViewDetails(session.id)}
                          disabled={session.status !== 'completed'}
                        >
                          View Details
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminPage() {
  return (
    <AdminGuard>
      <AdminPageContent />
    </AdminGuard>
  );
}
