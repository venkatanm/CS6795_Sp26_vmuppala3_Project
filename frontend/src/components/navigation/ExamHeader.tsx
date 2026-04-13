'use client';

import { useState, useEffect, useRef } from 'react';
import { Calculator, X, Star, ChevronDown, Clock, FileText, Cloud, CloudOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useExam } from '@/src/context/ExamContext';
import DirectionsModal from './DirectionsModal';
import styles from './ExamHeader.module.css';

interface ExamHeaderProps {
  /** Current question ID */
  questionId: string;
  
  /** Expires at timestamp (ISO string) */
  expiresAt?: string | null;
  
  /** Callback when time expires */
  onTimeExpire?: () => void;
  
  /** Section name (e.g., "Section 1: Reading and Writing") */
  sectionName?: string;
  
  /** Total questions in the current module (not all modules) */
  totalQuestions?: number;
  
  /** Callback to toggle calculator modal */
  onToggleCalculator?: () => void;
  
  /** Callback to toggle reference sheet modal */
  onToggleReference?: () => void;
  
  /** Sync status for answer synchronization */
  syncStatus?: 'synced' | 'syncing' | 'offline' | 'error';
}

/**
 * ExamHeader Component
 * 
 * Bluebook-style header with:
 * - Top bar: Branding, section name, timer, controls
 * - Bottom bar: Question counter
 */
export default function ExamHeader({ 
  questionId,
  expiresAt,
  onTimeExpire,
  sectionName = 'Section 1: Reading and Writing',
  totalQuestions: propTotalQuestions,
  onToggleCalculator,
  onToggleReference,
  syncStatus = 'synced'
}: ExamHeaderProps) {
  const { state } = useExam();
  // Persist timer visibility in localStorage
  const [isTimerVisible, setIsTimerVisible] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('exam_timer_visible');
      return saved !== 'false'; // Default to true if not set
    }
    return true;
  });
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [isDirectionsOpen, setIsDirectionsOpen] = useState(false);
  
  // Use ref to store onTimeExpire callback to avoid infinite loops
  const onTimeExpireRef = useRef(onTimeExpire);
  useEffect(() => {
    onTimeExpireRef.current = onTimeExpire;
  }, [onTimeExpire]);
  
  // Save timer visibility to localStorage when it changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('exam_timer_visible', String(isTimerVisible));
    }
  }, [isTimerVisible]);

  // Get config from current module or use defaults
  const config = state.currentModule?.config ?? {
    total_time: 3600,
    allowed_tools: [],
  };
  
  // Check if we're in review mode (exam is completed)
  const isReviewMode = state.session?.status === 'completed';
  
  // Only show timer if expiresAt is provided AND we're not in review mode
  const shouldShowTimer = !!expiresAt && !isReviewMode;

  // Calculate total questions for the CURRENT module only
  // Priority: Use prop if provided, otherwise calculate from current module
  const totalQuestions = propTotalQuestions ?? (() => {
    if (!state.currentModule?.module) return 0;
    return state.currentModule.module.question_order?.length || 0;
  })();

  // Get current question index from session
  const currentQuestionIndex = state.session?.currentQuestionIndex ?? 0;

  // Format time helper
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // Update timer every second
  useEffect(() => {
    if (!expiresAt || !isTimerVisible) return;

    const updateTimer = () => {
      try {
        const now = new Date();
        const expiry = new Date(expiresAt);
        const diff = expiry.getTime() - now.getTime();
        const remaining = Math.max(0, Math.floor(diff / 1000));
        setTimeRemaining(remaining);

        if (remaining === 0 && onTimeExpireRef.current) {
          onTimeExpireRef.current();
        }
      } catch {
        setTimeRemaining(0);
      }
    };

    // Initial update
    updateTimer();

    // Update every second
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [expiresAt, isTimerVisible]); // Removed onTimeExpire from dependencies - using ref instead

  const displayTime = formatTime(timeRemaining);

  // Determine if this is a Math section
  const isMathSection = sectionName.toLowerCase().includes('math');
  
  // Sync status icon and tooltip
  const getSyncIcon = () => {
    switch (syncStatus) {
      case 'synced':
        return <Cloud className="h-4 w-4 text-green-500" />;
      case 'syncing':
        return <Loader2 className="h-4 w-4 text-yellow-500 animate-spin" />;
      case 'offline':
        return <CloudOff className="h-4 w-4 text-gray-500" />;
      case 'error':
        return <CloudOff className="h-4 w-4 text-red-500" />;
      default:
        return <Cloud className="h-4 w-4 text-gray-400" />;
    }
  };
  
  const getSyncTooltip = () => {
    switch (syncStatus) {
      case 'synced':
        return 'All answers saved.';
      case 'syncing':
        return 'Saving...';
      case 'offline':
        return 'Offline. Saving to device.';
      case 'error':
        return 'Sync error. Retrying...';
      default:
        return 'Unknown sync status';
    }
  };

  return (
    <div className={styles.header}>
      {/* Top Bar - Branding, Section, Timer, Controls */}
      <div className={styles.topBar}>
        {/* Left: Branding and Section */}
        <div className={styles.branding}>
          <div className={styles.brandName}>
            <Star className="h-5 w-5 fill-current" />
            Bluebook
          </div>
          <div className={styles.sectionInfo}>
            <span>{sectionName}</span>
            <button 
              className={styles.directionsButton}
              onClick={() => setIsDirectionsOpen(true)}
              aria-label="Open directions"
            >
              Directions <ChevronDown className="h-4 w-4 inline" />
            </button>
          </div>
        </div>

        {/* Center: Timer with Show/Hide */}
        <div className={styles.centerSection}>
          {shouldShowTimer && expiresAt && (
            <div className={styles.timerSection}>
              {isTimerVisible ? (
                <>
                  <div className={styles.timerDisplay}>
                    <Clock className="h-6 w-6" />
                    <span className={styles.timerText}>{displayTime}</span>
                  </div>
                  <button 
                    className={styles.hideButton}
                    onClick={() => setIsTimerVisible(false)}
                    aria-label="Hide timer"
                  >
                    Hide
                  </button>
                </>
              ) : (
                <button 
                  className={styles.showButton}
                  onClick={() => setIsTimerVisible(true)}
                  aria-label="Show timer"
                >
                  <Clock className="h-6 w-6" />
                  Show
                </button>
              )}
            </div>
          )}
        </div>

        {/* Right: Tools and Sync Status */}
        <div className={styles.rightSection}>
          {/* Sync Status Indicator */}
          <div 
            className={styles.syncStatus}
            title={getSyncTooltip()}
            aria-label={getSyncTooltip()}
          >
            {getSyncIcon()}
          </div>
          
          {/* Only show calculator for Math sections */}
          {isMathSection && onToggleCalculator && (
            <Button
              variant="outline"
              size="sm"
              onClick={onToggleCalculator}
              className={styles.toolButton}
              aria-label="Calculator"
            >
              <div className={styles.toolButtonContent}>
                <Calculator className="h-4 w-4" />
                <span>Calculator</span>
              </div>
            </Button>
          )}
          
          {/* Only show reference sheet for Math sections */}
          {isMathSection && onToggleReference && (
            <Button
              variant="outline"
              size="sm"
              onClick={onToggleReference}
              className={styles.toolButton}
            >
              <div className={styles.toolButtonContent}>
                <FileText className="h-4 w-4" />
                <span>Reference</span>
              </div>
            </Button>
          )}
        </div>
      </div>

      {/* Bottom Bar - Question Counter */}
      <div className={styles.bottomBar}>
        <div className={styles.leftSection}>
          <div className={styles.questionCounter}>
            Question {currentQuestionIndex + 1} of {totalQuestions || '?'}
          </div>
        </div>
      </div>

      {/* Directions Modal */}
      <DirectionsModal
        isOpen={isDirectionsOpen}
        onClose={() => setIsDirectionsOpen(false)}
        sectionName={sectionName}
      />
    </div>
  );
}
