/**
 * Performance Audit for Orchestrator
 * 
 * Tracks and reports performance metrics for the Tutor-Critic loop.
 */

import { OrchestratorResult } from './orchestrator';

export interface PerformanceMetrics {
  /** Total time in milliseconds */
  totalTime: number;
  /** Tutor generation time */
  tutorTime: number;
  /** Critic evaluation time */
  criticTime: number;
  /** Number of retries */
  retryCount: number;
  /** Whether latency target was exceeded */
  exceededLatencyTarget: boolean;
  /** Timestamp */
  timestamp: number;
}

export interface PerformanceAudit {
  /** All recorded metrics */
  metrics: PerformanceMetrics[];
  /** Average total time */
  avgTotalTime: number;
  /** Average tutor time */
  avgTutorTime: number;
  /** Average critic time */
  avgCriticTime: number;
  /** P95 total time */
  p95TotalTime: number;
  /** P99 total time */
  p99TotalTime: number;
  /** Latency target exceed rate */
  exceedRate: number;
  /** Average retry count */
  avgRetryCount: number;
}

class PerformanceMonitor {
  private metrics: PerformanceMetrics[] = [];
  private readonly maxMetrics = 1000; // Keep last 1000 metrics

  /**
   * Record performance metrics
   */
  record(result: OrchestratorResult): void {
    if (!result.performance) {
      return;
    }

    const metric: PerformanceMetrics = {
      ...result.performance,
      timestamp: Date.now(),
    };

    this.metrics.push(metric);

    // Keep only last N metrics
    if (this.metrics.length > this.maxMetrics) {
      this.metrics.shift();
    }
  }

  /**
   * Get performance audit
   */
  getAudit(): PerformanceAudit {
    if (this.metrics.length === 0) {
      return {
        metrics: [],
        avgTotalTime: 0,
        avgTutorTime: 0,
        avgCriticTime: 0,
        p95TotalTime: 0,
        p99TotalTime: 0,
        exceedRate: 0,
        avgRetryCount: 0,
      };
    }

    const sorted = [...this.metrics].sort((a, b) => a.totalTime - b.totalTime);
    const totalTimes = sorted.map(m => m.totalTime);
    const tutorTimes = sorted.map(m => m.tutorTime);
    const criticTimes = sorted.map(m => m.criticTime);
    const retryCounts = sorted.map(m => m.retryCount);

    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const percentile = (arr: number[], p: number) => {
      const index = Math.ceil((p / 100) * arr.length) - 1;
      return arr[Math.max(0, index)];
    };

    return {
      metrics: sorted,
      avgTotalTime: avg(totalTimes),
      avgTutorTime: avg(tutorTimes),
      avgCriticTime: avg(criticTimes),
      p95TotalTime: percentile(totalTimes, 95),
      p99TotalTime: percentile(totalTimes, 99),
      exceedRate: sorted.filter(m => m.exceededLatencyTarget).length / sorted.length,
      avgRetryCount: avg(retryCounts),
    };
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics = [];
  }

  /**
   * Get recent metrics (last N)
   */
  getRecent(count: number = 10): PerformanceMetrics[] {
    return this.metrics.slice(-count);
  }
}

// Singleton instance
export const performanceMonitor = new PerformanceMonitor();

/**
 * Audit orchestrator performance
 */
export function auditOrchestratorPerformance(): PerformanceAudit {
  return performanceMonitor.getAudit();
}

/**
 * Record orchestrator result
 */
export function recordOrchestratorResult(result: OrchestratorResult): void {
  performanceMonitor.record(result);
}

/**
 * Format performance report as string
 */
export function formatPerformanceReport(audit: PerformanceAudit): string {
  const lines: string[] = [];
  
  lines.push('=== Orchestrator Performance Audit ===');
  lines.push('');
  lines.push(`Total Requests: ${audit.metrics.length}`);
  lines.push(`Average Total Time: ${audit.avgTotalTime.toFixed(2)}ms`);
  lines.push(`Average Tutor Time: ${audit.avgTutorTime.toFixed(2)}ms`);
  lines.push(`Average Critic Time: ${audit.avgCriticTime.toFixed(2)}ms`);
  lines.push(`P95 Total Time: ${audit.p95TotalTime.toFixed(2)}ms`);
  lines.push(`P99 Total Time: ${audit.p99TotalTime.toFixed(2)}ms`);
  lines.push(`Latency Target Exceed Rate: ${(audit.exceedRate * 100).toFixed(1)}%`);
  lines.push(`Average Retry Count: ${audit.avgRetryCount.toFixed(2)}`);
  lines.push('');
  
  if (audit.metrics.length > 0) {
    lines.push('Recent Metrics:');
    audit.metrics.slice(-5).forEach((metric, idx) => {
      lines.push(
        `  ${idx + 1}. Total: ${metric.totalTime}ms, ` +
        `Tutor: ${metric.tutorTime}ms, ` +
        `Critic: ${metric.criticTime}ms, ` +
        `Retries: ${metric.retryCount}, ` +
        `Exceeded: ${metric.exceededLatencyTarget ? 'Yes' : 'No'}`
      );
    });
  }
  
  return lines.join('\n');
}
