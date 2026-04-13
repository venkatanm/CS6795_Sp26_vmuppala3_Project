'use client';

import React, { memo } from 'react';
import MathText from '@/components/exam/MathText';

interface PassagePaneProps {
  /** Stimulus/passage text content - standardized on stimulus */
  stimulus?: string;
  /** @deprecated Use stimulus instead. Kept for backward compatibility. */
  passageText?: string;
  
  /** Optional passage ID for tracking */
  passageId?: string;
  
  /** Optional className */
  className?: string;
}

/**
 * PassagePane Component
 * 
 * Memoized component for displaying passage text in Reading sections.
 * Only re-renders when passageText actually changes, preventing unnecessary
 * re-renders when only the question changes.
 * 
 * This is critical for performance in Reading sections where multiple
 * questions share the same passage.
 */
const PassagePane = memo<PassagePaneProps>(({ stimulus, passageText, passageId, className = '' }) => {
  // Standardize on stimulus (primary), with fallback to passageText for backward compatibility
  const passageContent = stimulus || passageText || '';
  
  return (
    <div className={className} data-passage-id={passageId}>
      <div className="prose prose-lg max-w-none">
        <MathText>{passageContent}</MathText>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison: only re-render if stimulus/passageText or passageId changes
  const prevContent = prevProps.stimulus || prevProps.passageText || '';
  const nextContent = nextProps.stimulus || nextProps.passageText || '';
  return (
    prevContent === nextContent &&
    prevProps.passageId === nextProps.passageId &&
    prevProps.className === nextProps.className
  );
});

PassagePane.displayName = 'PassagePane';

export default PassagePane;
