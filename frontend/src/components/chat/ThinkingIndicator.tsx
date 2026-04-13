'use client';

import React from 'react';
import { Loader2, Brain, CheckCircle2, AlertCircle } from 'lucide-react';
import styles from './ThinkingIndicator.module.css';

export type ThinkingState = 
  | 'idle'
  | 'analyzing'
  | 'generating'
  | 'reviewing'
  | 'checking'
  | 'updating'
  | 'complete'
  | 'error';

export interface ThinkingIndicatorProps {
  /** Current thinking state */
  state: ThinkingState;
  /** Optional custom message */
  message?: string;
  /** Whether to show the indicator */
  visible?: boolean;
}

const STATE_MESSAGES: Record<ThinkingState, string> = {
  idle: '',
  analyzing: 'Analyzing your question...',
  generating: 'Generating response...',
  reviewing: 'Reviewing your work...',
  checking: 'Checking logic...',
  updating: 'Updating learning path...',
  complete: 'Complete',
  error: 'Error occurred',
};

const STATE_ICONS: Record<ThinkingState, typeof Loader2> = {
  idle: Loader2,
  analyzing: Brain,
  generating: Loader2,
  reviewing: CheckCircle2,
  checking: Brain,
  updating: Loader2,
  complete: CheckCircle2,
  error: AlertCircle,
};

/**
 * ThinkingIndicator Component
 * 
 * Shows optimistic UI feedback during the triad interaction loop:
 * - Tutor generation
 * - Critic evaluation
 * - Architect updates (background)
 */
export default function ThinkingIndicator({
  state,
  message,
  visible = true,
}: ThinkingIndicatorProps) {
  if (!visible || state === 'idle') {
    return null;
  }

  const displayMessage = message || STATE_MESSAGES[state];
  const Icon = STATE_ICONS[state];
  const isAnimated = state !== 'complete' && state !== 'error';

  return (
    <div className={`${styles.container} ${styles[state]}`}>
      <Icon 
        className={`${styles.icon} ${isAnimated ? styles.spinning : ''}`} 
        size={16} 
      />
      <span className={styles.message}>{displayMessage}</span>
      {state === 'generating' && (
        <span className={styles.dots}>
          <span className={styles.dot}>.</span>
          <span className={styles.dot}>.</span>
          <span className={styles.dot}>.</span>
        </span>
      )}
    </div>
  );
}

/**
 * Hook to manage thinking states during tutor interaction
 */
export function useThinkingState() {
  const [state, setState] = React.useState<ThinkingState>('idle');
  const [customMessage, setCustomMessage] = React.useState<string | undefined>();

  const setThinking = (newState: ThinkingState, message?: string) => {
    setState(newState);
    setCustomMessage(message);
  };

  const reset = () => {
    setState('idle');
    setCustomMessage(undefined);
  };

  return {
    state,
    message: customMessage,
    setThinking,
    reset,
  };
}
