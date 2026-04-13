'use client';

import { useEffect, ReactNode, memo, useMemo, useState, useRef, useCallback } from 'react';
import { GripVertical } from 'lucide-react';
import styles from './SplitScreen.module.css';

interface SplitScreenLayoutProps {
  /** Content for the left pane (passage) */
  leftPane: ReactNode;
  
  /** Content for the right pane (question) */
  rightPane: ReactNode;
  
  /** Optional className for the container */
  className?: string;
  
  /** Optional passage ID for memoization */
  passageId?: string;
  
  /** Optional question ID for memoization */
  questionId?: string;
}

/**
 * SplitScreenLayout Component
 * 
 * Optimized responsive split-screen layout for Reading & Writing sections.
 * 
 * Performance Optimizations:
 * - Memoized to prevent unnecessary re-renders
 * - Left pane (passage) is memoized separately to avoid re-rendering when only question changes
 * - Right pane (question) updates independently
 * 
 * Features:
 * - Fixed 100vh height container
 * - Two-column layout (50% width each on desktop)
 * - Independent scrolling for each pane
 * - Serif font for passage text (left pane)
 * - Bluebook-style spacing and typography
 */
const SplitScreenLayout = memo<SplitScreenLayoutProps>(({
  leftPane,
  rightPane,
  className = '',
  passageId,
  questionId,
}) => {
  const [leftWidth, setLeftWidth] = useState(50); // Start at 50% (equal split)
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(50);

  // Lock viewport and hide body overflow when component mounts
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    const originalHeight = document.body.style.height;
    
    // Set body styles to lock viewport
    document.body.style.overflow = 'hidden';
    document.body.style.height = '100vh';
    
    // Cleanup: restore original styles on unmount
    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.height = originalHeight;
    };
  }, []);

  // Handle mouse move during resize (defined first to avoid dependency issues)
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!containerRef.current) return;
    
    const containerWidth = containerRef.current.offsetWidth;
    const deltaX = e.clientX - startXRef.current;
    const deltaPercent = (deltaX / containerWidth) * 100;
    
    // Calculate new left width (clamp between 20% and 80%)
    const newWidth = Math.max(20, Math.min(80, startWidthRef.current + deltaPercent));
    setLeftWidth(newWidth);
  }, []);

  // Handle mouse up (end resize)
  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  }, [handleMouseMove]);

  // Handle mouse down on divider
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = leftWidth;
    
    // Add global mouse move and up listeners
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [leftWidth, handleMouseMove, handleMouseUp]);

  // Cleanup event listeners
  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  // Memoize left pane to prevent re-rendering when only question changes
  const memoizedLeftPane = useMemo(() => leftPane, [leftPane, passageId]);
  
  // Memoize right pane based on question ID
  const memoizedRightPane = useMemo(() => rightPane, [rightPane, questionId]);

  return (
    <div ref={containerRef} className={`${styles.container} ${className} ${isResizing ? styles.resizing : ''}`}>
      {/* Left Pane - Passage */}
      <div 
        className={styles.leftPane}
        style={{ width: `${leftWidth}%`, flex: `0 0 ${leftWidth}%` }}
      >
        <div className={styles.paneContent}>
          {memoizedLeftPane}
        </div>
      </div>

      {/* Resizable Divider */}
      <div 
        className={`${styles.divider} ${styles.resizableDivider}`}
        onMouseDown={handleMouseDown}
      >
        <div className={styles.dividerHandle}>
          <GripVertical className={styles.dividerIcon} />
        </div>
      </div>

      {/* Right Pane - Question */}
      <div 
        className={styles.rightPane}
        style={{ width: `${100 - leftWidth}%`, flex: `0 0 ${100 - leftWidth}%` }}
      >
        <div className={styles.paneContent}>
          {memoizedRightPane}
        </div>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison: only re-render if props actually change
  // This prevents re-renders when parent re-renders but props are the same
  return (
    prevProps.leftPane === nextProps.leftPane &&
    prevProps.rightPane === nextProps.rightPane &&
    prevProps.className === nextProps.className &&
    prevProps.passageId === nextProps.passageId &&
    prevProps.questionId === nextProps.questionId
  );
});

SplitScreenLayout.displayName = 'SplitScreenLayout';

export default SplitScreenLayout;
