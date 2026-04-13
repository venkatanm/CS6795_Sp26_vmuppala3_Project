'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  ReferenceLine,
  Cell,
} from 'recharts';
import { TrendingUp, Target, BookOpen, AlertCircle } from 'lucide-react';

interface SkillNode {
  id: string;
  name: string;
  type: 'domain' | 'skill';
  accuracy: number | null;
  total_attempts: number | null;
  correct_attempts: number | null;
}

interface GraphData {
  nodes: SkillNode[];
  links: { source: string; target: string }[];
}

interface Session {
  id: string;
  exam_title: string;
  status: string;
  score: number | null;
  created_at: string;
}

interface ProgressPanelProps {
  userId?: string;
  sessions: Session[];
}

function getMasteryColor(accuracy: number | null): string {
  if (accuracy === null) return '#6b7280';
  if (accuracy >= 0.85) return '#10b981';
  if (accuracy >= 0.60) return '#f59e0b';
  return '#ef4444';
}

function getMasteryLabel(accuracy: number | null): string {
  if (accuracy === null) return 'Not started';
  if (accuracy >= 0.85) return 'Strong';
  if (accuracy >= 0.60) return 'Developing';
  return 'Needs work';
}

// Custom tooltip for bar chart
function DomainTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const value = payload[0].value as number;
  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 shadow-lg">
      <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 mb-1">{label}</p>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Accuracy: <span className="font-bold" style={{ color: getMasteryColor(value / 100) }}>{value}%</span>
      </p>
    </div>
  );
}

// Custom tooltip for score trend
function ScoreTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 shadow-lg">
      <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">{label}</p>
      <p className="text-sm font-bold text-indigo-600 dark:text-indigo-400">{payload[0].value} est. score</p>
    </div>
  );
}

export default function ProgressPanel({ userId, sessions }: ProgressPanelProps) {
  const router = useRouter();
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);

  const completedSessions = sessions.filter(s => s.status === 'completed' && s.score !== null);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }

    fetch(`/api/curriculum/graph`, {
      headers: { 'X-User-ID': userId },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => setGraphData(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userId]);

  // --- Derive domain accuracy data from graph nodes + links ---
  const domainData = (() => {
    if (!graphData) return [];
    const domainMap = new Map<string, { name: string; total: number; correct: number }>();
    const skillToDomain = new Map<string, string>();

    graphData.nodes.forEach(n => {
      if (n.type === 'domain') domainMap.set(n.id, { name: n.name, total: 0, correct: 0 });
    });
    graphData.links.forEach(l => {
      skillToDomain.set(l.source, l.target);
    });
    graphData.nodes.forEach(n => {
      if (n.type !== 'skill' || !n.total_attempts) return;
      const domainId = skillToDomain.get(n.id);
      if (!domainId) return;
      const domain = domainMap.get(domainId);
      if (!domain) return;
      domain.total += n.total_attempts;
      domain.correct += n.correct_attempts ?? 0;
    });

    return Array.from(domainMap.values())
      .map(d => ({
        name: d.name.replace('and ', '& ').replace('Problem-Solving and Data Analysis', 'Data Analysis'),
        accuracy: d.total > 0 ? Math.round((d.correct / d.total) * 100) : 0,
        attempts: d.total,
      }))
      .sort((a, b) => a.accuracy - b.accuracy);
  })();

  // --- Weakest skills ---
  const weakSkills = (() => {
    if (!graphData) return [];
    return graphData.nodes
      .filter(n => n.type === 'skill' && n.total_attempts && n.total_attempts > 0)
      .map(n => ({ name: n.name, accuracy: n.accuracy ?? 0, attempts: n.total_attempts ?? 0 }))
      .sort((a, b) => a.accuracy - b.accuracy)
      .slice(0, 5);
  })();

  // --- Score trend ---
  const scoreTrend = completedSessions
    .filter(s => s.score !== null)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .map((s, i) => ({
      name: new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      score: Math.round(s.score!),
      label: s.exam_title,
      index: i + 1,
    }));

  const hasData = domainData.length > 0;
  const hasAnsweredData = domainData.some(d => d.attempts > 0);
  const hasScores = scoreTrend.length >= 2;

  if (loading) {
    return (
      <Card className="border-zinc-200 dark:border-zinc-800">
        <CardContent className="py-12 text-center">
          <p className="text-sm text-zinc-400 animate-pulse">Loading progress...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Score Trend (only shown when 2+ scored sessions exist) */}
      {hasScores && (
        <Card className="border-zinc-200 dark:border-zinc-800">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-indigo-500" />
              <CardTitle className="text-base">Score Trend</CardTitle>
              <Badge variant="outline" className="text-xs ml-auto">
                Est. SAT Score
              </Badge>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              Estimated scores are for training purposes only.
            </p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={scoreTrend} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,100,100,0.15)" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis domain={[200, 800]} ticks={[200, 400, 600, 800]} tick={{ fontSize: 11 }} width={36} />
                <Tooltip content={<ScoreTooltip />} />
                <ReferenceLine y={1000} stroke="transparent" />
                <Line
                  type="monotone"
                  dataKey="score"
                  stroke="#6366f1"
                  strokeWidth={2.5}
                  dot={{ r: 5, fill: '#6366f1', stroke: '#fff', strokeWidth: 2 }}
                  activeDot={{ r: 7 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Domain Accuracy Bar Chart */}
      <Card className="border-zinc-200 dark:border-zinc-800">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-indigo-500" />
              <CardTitle className="text-base">Accuracy by Domain</CardTitle>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              {hasAnsweredData
                ? 'Based on all completed questions — sorted weakest first'
                : 'Complete questions to see your accuracy by domain'}
            </p>
          </CardHeader>
          <CardContent>
            {hasData ? (
              <>
                <ResponsiveContainer width="100%" height={Math.max(200, domainData.length * 42)}>
                  <BarChart
                    layout="vertical"
                    data={domainData}
                    margin={{ top: 0, right: 48, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,100,100,0.15)" horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 11 }} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={160}
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                    />
                    <Tooltip content={<DomainTooltip />} />
                    <ReferenceLine x={60} stroke="#f59e0b" strokeDasharray="4 2" label={{ value: '60%', fontSize: 10, fill: '#f59e0b', position: 'top' }} />
                    <Bar dataKey="accuracy" radius={[0, 4, 4, 0]} maxBarSize={24}>
                      {domainData.map((entry, i) => (
                        <Cell key={i} fill={getMasteryColor(entry.accuracy / 100)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                {/* Legend */}
                <div className="flex items-center gap-4 mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800">
                  {[
                    { color: '#10b981', label: '≥85% Strong' },
                    { color: '#f59e0b', label: '60–84% Developing' },
                    { color: '#ef4444', label: '<60% Needs work' },
                  ].map(({ color, label }) => (
                    <div key={label} className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color }} />
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">{label}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="py-8 text-center">
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-indigo-50 dark:bg-indigo-900/30 mb-3">
                  <Target className="h-5 w-5 text-indigo-500" />
                </div>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">No domain data yet — complete questions to see your accuracy.</p>
              </div>
            )}
          </CardContent>
        </Card>

      {/* Weakest Skills — priority focus list */}
      {weakSkills.length > 0 && (
        <Card className="border-zinc-200 dark:border-zinc-800">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-orange-500" />
              <CardTitle className="text-base">Skills to Focus On</CardTitle>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              Your lowest-accuracy skills — these have the most room for improvement
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {weakSkills.map((skill, i) => (
                <div key={skill.name} className="flex items-center gap-3">
                  <span className="text-xs font-bold text-zinc-400 w-4 text-right">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
                        {skill.name}
                      </span>
                      <span
                        className="text-xs font-bold ml-2 flex-shrink-0"
                        style={{ color: getMasteryColor(skill.accuracy) }}
                      >
                        {Math.round(skill.accuracy * 100)}%
                      </span>
                    </div>
                    <div className="w-full bg-zinc-100 dark:bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.round(skill.accuracy * 100)}%`,
                          backgroundColor: getMasteryColor(skill.accuracy),
                        }}
                      />
                    </div>
                    <span className="text-xs text-zinc-400">{skill.attempts} attempts</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
