'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { X, Target, TrendingUp } from 'lucide-react';

// Dynamically import ForceGraph2D with SSR disabled (required for Canvas)
const ForceGraph2D = dynamic(
  () => import('react-force-graph-2d').then((mod) => mod.default),
  { ssr: false }
) as any;

interface GraphNode {
  id: string;
  name: string;
  type: 'domain' | 'skill';
  color: string;
  value: number;
  accuracy?: number | null;
  total_attempts?: number | null;
  correct_attempts?: number | null;
}

interface GraphLink {
  source: string;
  target: string;
}

interface CurriculumGraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

interface SkillGalaxyProps {
  userId?: string;
  noCardWrapper?: boolean; // If true, renders without Card wrapper (for dashboard integration)
}

export default function SkillGalaxy({ userId, noCardWrapper = false }: SkillGalaxyProps) {
  const router = useRouter();
  const [graphData, setGraphData] = useState<CurriculumGraphData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const graphRef = useRef<any>(null);

  // Fetch curriculum graph data
  useEffect(() => {
    const fetchGraphData = async () => {
      if (!userId) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);

        const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
        const response = await fetch(`${backendUrl}/api/curriculum/graph`, {
          headers: {
            'X-User-ID': userId,
            'X-Tenant-ID': 'public'
          }
        });

        if (!response.ok) {
          // Handle 401 (unauthorized) gracefully - user might not be logged in
          if (response.status === 401) {
            setError('Please sign in to view skills');
            setIsLoading(false);
            return;
          }
          // Handle 404 (not found) - curriculum data might not be initialized
          if (response.status === 404) {
            setError('Curriculum data not available. Please complete a diagnostic first.');
            setIsLoading(false);
            return;
          }
          // Handle 500 (server error) gracefully - backend issue, not user's fault
          if (response.status === 500) {
            console.warn('[SkillGalaxy] Backend server error - showing empty state');
            setGraphData(null);
            setError(null); // Don't show error for server issues
            setIsLoading(false);
            return;
          }
          throw new Error(`Failed to fetch curriculum graph: ${response.statusText}`);
        }

        const data = await response.json();
        setGraphData(data);
      } catch (err: any) {
        console.error('Error fetching curriculum graph:', err);
        // Handle network errors gracefully - don't show error for connection issues
        // This is an optional feature that doesn't affect exam functionality
        if (err.message?.includes('fetch') || err.message?.includes('Network') || err.name === 'TypeError') {
          // For connection errors, silently fail and show empty state instead of error
          // This prevents showing scary error messages for an optional feature
          console.log('[SkillGalaxy] Backend not available - showing empty state instead of error');
          setGraphData(null); // Set to null to show empty state
          setError(null); // Don't show error
        } else if (err.message?.includes('401') || err.message?.includes('Unauthorized')) {
          setError('Please sign in to view skills');
        } else if (err.message?.includes('404') || err.message?.includes('Not Found')) {
          // For 404, also show empty state instead of error
          setGraphData(null);
          setError(null);
        } else if (err.message?.includes('500') || err.message?.includes('Internal Server Error')) {
          // For 500, show empty state - backend issue, not user's fault
          console.warn('[SkillGalaxy] Backend server error - showing empty state');
          setGraphData(null);
          setError(null);
        } else {
          // Only show error for unexpected errors
          setError(err.message || 'Failed to load skill graph');
        }
      } finally {
        setIsLoading(false);
      }
    };

    fetchGraphData();
  }, [userId]);

  // Handle node click
  const handleNodeClick = useCallback((node: GraphNode) => {
    // Only show modal for skills (not domains)
    if (node.type === 'skill') {
      setSelectedNode(node);
      setIsModalOpen(true);
    }
  }, []);

  // Handle practice button click
  const handlePracticeSkill = () => {
    if (selectedNode) {
      router.push(`/practice/daily?skill_id=${selectedNode.id}`);
      setIsModalOpen(false);
    }
  };

  // Custom node paint function
  const nodeCanvasObject = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const graphNode = node as GraphNode;
    
    if (graphNode.type === 'domain') {
      // Draw domain as text label
      const label = graphNode.name;
      const fontSize = 16 / globalScale;
      ctx.font = `${fontSize}px Sans-Serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = graphNode.color || '#3b82f6';
      ctx.fillText(label, node.x || 0, node.y || 0);
    } else {
      // Draw skill as circle with glow effect
      const radius = 8;
      
      // Glow effect (shadow)
      ctx.shadowBlur = 15;
      ctx.shadowColor = graphNode.color || '#4b5563';
      
      // Draw circle
      ctx.beginPath();
      ctx.arc(node.x || 0, node.y || 0, radius, 0, 2 * Math.PI);
      ctx.fillStyle = graphNode.color || '#4b5563';
      ctx.fill();
      
      // Reset shadow
      ctx.shadowBlur = 0;
    }
  }, []);

  // Render loading state
  if (isLoading) {
    const loadingContent = (
      <div className="text-center text-sm text-zinc-500 dark:text-zinc-400 py-12">
        Loading skill graph...
      </div>
    );
    
    if (noCardWrapper) {
      return loadingContent;
    }
    
    return (
      <Card className="border-zinc-200 dark:border-zinc-800">
        <CardContent className="py-12">
          {loadingContent}
        </CardContent>
      </Card>
    );
  }

  // Render error state
  if (error) {
    const errorContent = (
      <div className="text-center py-12 px-4">
        <div className="inline-block bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 max-w-md">
          <p className="text-yellow-800 dark:text-yellow-200 text-sm font-medium mb-2">{error}</p>
          <p className="text-yellow-600 dark:text-yellow-400 text-xs">
            {error.includes('connect') || error.includes('API') || error.includes('server')
              ? 'The Knowledge Galaxy feature requires a backend connection. This is optional and does not affect exam functionality.'
              : 'This feature will be available once you complete a diagnostic exam.'}
          </p>
        </div>
      </div>
    );
    
    if (noCardWrapper) {
      return errorContent;
    }
    
    return (
      <Card className="border-zinc-200 dark:border-zinc-800">
        <CardContent className="py-12">
          {errorContent}
        </CardContent>
      </Card>
    );
  }

  // Render empty state (no error, just no data)
  if (!graphData || graphData.nodes.length === 0) {
    const emptyContent = (
      <div className="text-center py-12 px-4">
        <div className="inline-block bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-lg p-6 max-w-md">
          <p className="text-zinc-600 dark:text-zinc-400 text-sm mb-2">
            Knowledge Galaxy
          </p>
          <p className="text-zinc-500 dark:text-zinc-500 text-xs">
            {!isLoading 
              ? 'Skill mastery data will appear here once your diagnostic exam responses are synced to the backend. This feature requires a backend connection and synced session data.'
              : 'Loading skill graph...'}
          </p>
        </div>
      </div>
    );
    
    if (noCardWrapper) {
      return emptyContent;
    }
    
    return (
      <Card className="border-zinc-200 dark:border-zinc-800">
        <CardContent className="py-12">
          {emptyContent}
        </CardContent>
      </Card>
    );
  }

  // Main graph content
  const graphContent = (
    <>
      <div className="w-full h-[500px] rounded-lg overflow-hidden bg-slate-950 dark:bg-slate-950 border border-zinc-800">
        {ForceGraph2D && (
          <ForceGraph2D
            ref={graphRef}
            graphData={graphData}
            nodeLabel={(node: any) => {
              const graphNode = node as GraphNode;
              return `${graphNode.name}${graphNode.accuracy !== null && graphNode.accuracy !== undefined ? ` (${Math.round(graphNode.accuracy * 100)}%)` : ''}`;
            }}
            nodeColor={(node: any) => {
              const graphNode = node as GraphNode;
              return graphNode.color;
            }}
            linkColor={() => 'rgba(255, 255, 255, 0.2)'}
            linkWidth={1}
            nodeCanvasObject={nodeCanvasObject}
            onNodeClick={(node: any) => handleNodeClick(node as GraphNode)}
            cooldownTicks={100}
            onEngineStop={() => {
              if (graphRef.current) {
                graphRef.current.zoomToFit(400, 20);
              }
            }}
            backgroundColor="rgba(2, 6, 23, 1)"
          />
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
        <span className="text-xs text-gray-600 dark:text-gray-400">Skill Mastery:</span>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-green-500" style={{ boxShadow: '0 0 8px #10b981' }}></div>
          <span className="text-xs text-gray-600 dark:text-gray-400">85%+</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-yellow-500" style={{ boxShadow: '0 0 8px #f59e0b' }}></div>
          <span className="text-xs text-gray-600 dark:text-gray-400">50-84%</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500" style={{ boxShadow: '0 0 8px #ef4444' }}></div>
          <span className="text-xs text-gray-600 dark:text-gray-400">1-49%</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-gray-500"></div>
          <span className="text-xs text-gray-600 dark:text-gray-400">No attempts</span>
        </div>
      </div>
    </>
  );

  // Return with or without Card wrapper
  if (noCardWrapper) {
    return (
      <>
        {graphContent}

        {/* Skill Detail Modal */}
        {isModalOpen && selectedNode && selectedNode.type === 'skill' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setIsModalOpen(false)}
        >
          <div
            className="bg-white dark:bg-zinc-900 rounded-lg shadow-xl max-w-md w-full mx-4 p-6 border border-zinc-200 dark:border-zinc-800"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div
                  className="w-4 h-4 rounded-full"
                  style={{
                    backgroundColor: selectedNode.color,
                    boxShadow: `0 0 8px ${selectedNode.color}`
                  }}
                ></div>
                <h3 className="text-xl font-bold text-black dark:text-zinc-50">
                  {selectedNode.name}
                </h3>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsModalOpen(false)}
                className="h-8 w-8"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Accuracy Display */}
            {selectedNode.accuracy !== null && selectedNode.accuracy !== undefined ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Mastery
                  </span>
                  <span className="text-sm font-bold text-gray-900 dark:text-zinc-50">
                    {Math.round(selectedNode.accuracy * 100)}%
                  </span>
                </div>
                
                {/* Progress Bar */}
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${selectedNode.accuracy * 100}%`,
                      backgroundColor: selectedNode.color
                    }}
                  ></div>
                </div>

                {/* Stats */}
                {selectedNode.total_attempts !== null && selectedNode.total_attempts !== undefined && (
                  <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
                    <div className="flex items-center gap-1">
                      <Target className="h-4 w-4" />
                      <span>{selectedNode.total_attempts} attempts</span>
                    </div>
                    {selectedNode.correct_attempts !== null && selectedNode.correct_attempts !== undefined && (
                      <div className="flex items-center gap-1">
                        <TrendingUp className="h-4 w-4" />
                        <span>{selectedNode.correct_attempts} correct</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                No attempts yet. Start practicing to see your progress!
              </div>
            )}

            {/* Practice Button */}
            <Button
              onClick={handlePracticeSkill}
              className="w-full mt-6 bg-indigo-600 hover:bg-indigo-700 text-white"
              size="lg"
            >
              Practice This Skill
            </Button>
          </div>
        </div>
      )}
      </>
    );
  }

  // Return with Card wrapper (default)
  return (
    <>
      <Card className="border-zinc-200 dark:border-zinc-800">
        <CardHeader>
          <CardTitle>Skill Galaxy</CardTitle>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-2">
            Interactive visualization of your skill mastery across all domains
          </p>
        </CardHeader>
        <CardContent>
          {graphContent}
        </CardContent>
      </Card>

      {/* Skill Detail Modal */}
      {isModalOpen && selectedNode && selectedNode.type === 'skill' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setIsModalOpen(false)}
        >
          <div
            className="bg-white dark:bg-zinc-900 rounded-lg shadow-xl max-w-md w-full mx-4 p-6 border border-zinc-200 dark:border-zinc-800"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div
                  className="w-4 h-4 rounded-full"
                  style={{
                    backgroundColor: selectedNode.color,
                    boxShadow: `0 0 8px ${selectedNode.color}`
                  }}
                ></div>
                <h3 className="text-xl font-bold text-black dark:text-zinc-50">
                  {selectedNode.name}
                </h3>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsModalOpen(false)}
                className="h-8 w-8"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Accuracy Display */}
            {selectedNode.accuracy !== null && selectedNode.accuracy !== undefined ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Mastery
                  </span>
                  <span className="text-sm font-bold text-gray-900 dark:text-zinc-50">
                    {Math.round(selectedNode.accuracy * 100)}%
                  </span>
                </div>
                
                {/* Progress Bar */}
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${selectedNode.accuracy * 100}%`,
                      backgroundColor: selectedNode.color
                    }}
                  ></div>
                </div>

                {/* Stats */}
                {selectedNode.total_attempts !== null && selectedNode.total_attempts !== undefined && (
                  <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
                    <div className="flex items-center gap-1">
                      <Target className="h-4 w-4" />
                      <span>{selectedNode.total_attempts} attempts</span>
                    </div>
                    {selectedNode.correct_attempts !== null && selectedNode.correct_attempts !== undefined && (
                      <div className="flex items-center gap-1">
                        <TrendingUp className="h-4 w-4" />
                        <span>{selectedNode.correct_attempts} correct</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                No attempts yet. Start practicing to see your progress!
              </div>
            )}

            {/* Practice Button */}
            <Button
              onClick={handlePracticeSkill}
              className="w-full mt-6 bg-indigo-600 hover:bg-indigo-700 text-white"
              size="lg"
            >
              Practice This Skill
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
