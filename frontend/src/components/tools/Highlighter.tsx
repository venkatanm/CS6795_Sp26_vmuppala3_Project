'use client';

import { useEffect, useRef, useState, ReactNode, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import styles from './Highlighter.module.css';

export type HighlightColor = 'yellow' | 'blue';

interface HighlightRange {
  start: number;
  end: number;
  color?: HighlightColor;
}

interface HighlighterProps {
  /** The passage content to highlight */
  children: ReactNode;
  
  /** Array of highlight ranges */
  highlights: Array<HighlightRange>;
  
  /** Callback when a highlight is added */
  onHighlight: (start: number, end: number, color: HighlightColor) => void;
  
  /** Callback when a highlight is removed */
  onRemoveHighlight?: (start: number, end: number) => void;
  
  /** Optional className */
  className?: string;
}

/**
 * Highlighter Component
 * 
 * Allows users to select text and highlight it with a yellow marker.
 * Highlights are persisted and rehydrated on component load.
 */
export default function Highlighter({
  children,
  highlights,
  onHighlight,
  onRemoveHighlight,
  className = '',
}: HighlighterProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const [selectedColor, setSelectedColor] = useState<HighlightColor>('yellow');
  const [clickedHighlight, setClickedHighlight] = useState<{ start: number; end: number } | null>(null);
  const markClickHandledRef = useRef(false); // Flag to prevent mouseup from interfering

  // Rehydrate highlights on mount and when highlights change
  // Use a ref to track if we're currently applying highlights to prevent race conditions
  const isApplyingHighlightsRef = useRef(false);
  
  useEffect(() => {
    if (!containerRef.current || isApplyingHighlightsRef.current) return;

    const container = containerRef.current;
    
    // Clear any existing selection to prevent conflicts
    const currentSelection = window.getSelection();
    if (currentSelection) {
      currentSelection.removeAllRanges();
    }
    
    // Hide tooltip during rehydration
    setShowTooltip(false);
    setSelection(null);

    isApplyingHighlightsRef.current = true;
    
    // Use requestAnimationFrame to ensure DOM is stable
    requestAnimationFrame(() => {
      if (!containerRef.current) {
        isApplyingHighlightsRef.current = false;
        return;
      }

      const container = containerRef.current;
      const textContent = container.textContent || '';
      
      // Remove existing highlights
      const existingMarks = container.querySelectorAll('mark');
      existingMarks.forEach((mark) => {
        const parent = mark.parentNode;
        if (parent) {
          parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
          parent.normalize();
        }
      });

      // Apply highlights
      if (highlights.length > 0 && textContent.length > 0) {
        // Sort highlights by start position (descending) to apply from end to start
        // This prevents offset issues when inserting marks
        const sortedHighlights = [...highlights].sort((a, b) => b.start - a.start);

        for (const highlight of sortedHighlights) {
          if (highlight.start >= 0 && highlight.end <= textContent.length) {
            applyHighlight(container, highlight.start, highlight.end, highlight.color || 'yellow');
          }
        }
      }
      
      isApplyingHighlightsRef.current = false;
    });
  }, [highlights]);

  /**
   * Apply a highlight to the container at the specified character offsets
   */
  const applyHighlight = (container: HTMLElement, start: number, end: number, color: HighlightColor = 'yellow') => {
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      null
    );

    let currentOffset = 0;
    let startNode: Node | null = null;
    let startOffset = 0;
    let endNode: Node | null = null;
    let endOffset = 0;

    let node: Node | null;
    while ((node = walker.nextNode())) {
      const nodeLength = node.textContent?.length || 0;
      const nodeEnd = currentOffset + nodeLength;

      if (!startNode && start >= currentOffset && start < nodeEnd) {
        startNode = node;
        startOffset = start - currentOffset;
      }

      if (!endNode && end >= currentOffset && end <= nodeEnd) {
        endNode = node;
        endOffset = end - currentOffset;
        break;
      }

      currentOffset = nodeEnd;
    }

    if (startNode && endNode) {
      const range = document.createRange();
      
      if (startNode === endNode) {
        // Highlight is within a single text node
        range.setStart(startNode, startOffset);
        range.setEnd(endNode, endOffset);
      } else {
        // Highlight spans multiple nodes
        range.setStart(startNode, startOffset);
        range.setEnd(endNode, endOffset);
      }

      const mark = document.createElement('mark');
      mark.className = color === 'blue' ? styles.highlightBlue : styles.highlight;
      try {
        range.surroundContents(mark);
      } catch (e) {
        // If surroundContents fails, extract and wrap
        const contents = range.extractContents();
        mark.appendChild(contents);
        range.insertNode(mark);
      }
    }
  };

  /**
   * Calculate character offset of a node within the container
   */
  const getTextOffset = (node: Node, offset: number): number => {
    if (!containerRef.current) return 0;

    const walker = document.createTreeWalker(
      containerRef.current,
      NodeFilter.SHOW_TEXT,
      null
    );

    let currentOffset = 0;
    let nodeToFind: Node | null = null;

    while ((nodeToFind = walker.nextNode())) {
      if (nodeToFind === node) {
        return currentOffset + offset;
      }
      currentOffset += nodeToFind.textContent?.length || 0;
    }

    return 0;
  };

  /**
   * Calculate character offset using TreeWalker for accurate counting
   * This handles special characters, formatting, and existing highlights correctly
   */
  const calculateTextOffset = (container: Node, targetNode: Node, targetOffset: number): number => {
    // If targetNode is not a text node, try to find the text node it contains
    let actualTargetNode: Node = targetNode;
    let actualOffset = targetOffset;

    // If targetNode is an element (like <mark>), find the first text node within it
    if (targetNode.nodeType !== Node.TEXT_NODE) {
      const textNodes: Node[] = [];
      const walker = document.createTreeWalker(
        targetNode,
        NodeFilter.SHOW_TEXT,
        null
      );
      let textNode: Node | null;
      while ((textNode = walker.nextNode())) {
        textNodes.push(textNode);
      }
      if (textNodes.length > 0) {
        actualTargetNode = textNodes[0];
        actualOffset = 0;
      }
    }

    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      null
    );

    let offset = 0;
    let node: Node | null;

    while ((node = walker.nextNode())) {
      if (node === actualTargetNode) {
        // Found the target node, add the offset within that node
        // This works even if the node is inside a <mark> element
        return offset + Math.min(actualOffset, node.textContent?.length || 0);
      }
      // Add the length of this text node
      // This counts text even if it's inside highlight marks
      offset += node.textContent?.length || 0;
    }

    // Fallback: if we can't find the node, try using Range API
    try {
      const range = document.createRange();
      range.selectNodeContents(container);
      range.setEnd(actualTargetNode, Math.min(actualOffset, actualTargetNode.textContent?.length || 0));
      return range.toString().length;
    } catch (e) {
      console.warn('[Highlighter] Error calculating offset, using fallback:', e);
      return 0;
    }
  };

  /**
   * Find which highlight contains the given point
   */
  const findHighlightAtPoint = useCallback((point: number): { start: number; end: number } | null => {
    for (const highlight of highlights) {
      if (point >= highlight.start && point < highlight.end) {
        return highlight;
      }
    }
    return null;
  }, [highlights]);

  /**
   * Get highlight range from a mark element
   */
  const getHighlightRangeFromMark = useCallback((mark: HTMLElement): { start: number; end: number } | null => {
    const container = containerRef.current;
    if (!container) {
      console.warn('[Highlighter] Container ref is null');
      return null;
    }

    try {
      // Method 1: Use Range API to get the mark's position relative to container
      const markRange = document.createRange();
      markRange.selectNodeContents(mark);
      
      // Get the first and last text nodes within the mark
      const walker = document.createTreeWalker(
        mark,
        NodeFilter.SHOW_TEXT,
        null
      );
      
      const textNodes: Node[] = [];
      let textNode: Node | null;
      while ((textNode = walker.nextNode())) {
        textNodes.push(textNode);
      }
      
      if (textNodes.length === 0) {
        console.warn('[Highlighter] No text nodes found in mark element');
        return null;
      }
      
      const firstTextNode = textNodes[0];
      const lastTextNode = textNodes[textNodes.length - 1];
      
      // Calculate start offset (position of first text node)
      const start = calculateTextOffset(container, firstTextNode, 0);
      
      // Calculate end offset (position of last text node + its length)
      const lastNodeLength = lastTextNode.textContent?.length || 0;
      const end = calculateTextOffset(container, lastTextNode, lastNodeLength);
      
      console.log('[Highlighter] Calculated range from mark:', { start, end, textNodesCount: textNodes.length });

      if (start >= 0 && end > start) {
        // Try to find matching highlight in the highlights array
        // This handles cases where the calculated range might be slightly off
        const matchingHighlight = highlights.find(h => {
          // Check if the mark's range overlaps with or matches a stored highlight
          // Use a small tolerance (5 characters) for matching
          const tolerance = 5;
          return (Math.abs(start - h.start) <= tolerance && Math.abs(end - h.end) <= tolerance) ||
                 (start >= h.start - tolerance && start < h.end + tolerance) || 
                 (end > h.start - tolerance && end <= h.end + tolerance) ||
                 (start <= h.start + tolerance && end >= h.end - tolerance);
        });
        
        if (matchingHighlight) {
          console.log('[Highlighter] Found matching highlight:', matchingHighlight);
          // Return the exact stored highlight range
          return { start: matchingHighlight.start, end: matchingHighlight.end };
        }
        
        console.log('[Highlighter] No matching highlight found, using calculated range');
        // If no exact match, return calculated range
        return { start, end };
      } else {
        console.warn('[Highlighter] Invalid calculated range:', { start, end });
      }
    } catch (error) {
      console.error('[Highlighter] Error calculating mark position:', error);
    }
    return null;
  }, [highlights]);

  /**
   * Handle click on highlighted text (mark element)
   */
  const handleMarkClick = useCallback((e: MouseEvent) => {
    // Prevent handling while highlights are being rehydrated
    if (isApplyingHighlightsRef.current) {
      console.log('[Highlighter] Skipping mark click - highlights being applied');
      return;
    }

    const target = e.target as HTMLElement;
    const clickedMark = target.closest('mark') as HTMLElement | null;

    console.log('[Highlighter] handleMarkClick called', { 
      target: target.tagName, 
      clickedMark: clickedMark ? 'found' : 'not found',
      containerExists: !!containerRef.current 
    });

    if (clickedMark && containerRef.current) {
      e.preventDefault();
      e.stopPropagation();
      
      // Set flag to prevent mouseup from interfering
      markClickHandledRef.current = true;
      
      // User clicked on highlighted text - show unhighlight option
      const highlightRange = getHighlightRangeFromMark(clickedMark);
      console.log('[Highlighter] Highlight range calculated:', highlightRange);
      
      if (highlightRange) {
        console.log('[Highlighter] Setting clickedHighlight and showing tooltip');
        setClickedHighlight(highlightRange);
        setSelection(highlightRange);
        
        // Clear any existing selection
        window.getSelection()?.removeAllRanges();
        
        // Show tooltip near the clicked mark
        const rect = clickedMark.getBoundingClientRect();
        setTooltipPosition({
          x: rect.left + rect.width / 2,
          y: rect.top - 10,
        });
        setShowTooltip(true);
        
        // Reset flag after a short delay
        setTimeout(() => {
          markClickHandledRef.current = false;
        }, 100);
      } else {
        console.warn('[Highlighter] Could not get highlight range from mark');
        markClickHandledRef.current = false;
      }
    } else {
      console.warn('[Highlighter] No mark element found or container missing', {
        clickedMark: !!clickedMark,
        container: !!containerRef.current
      });
    }
  }, [getHighlightRangeFromMark]);

  /**
   * Handle text selection
   */
  const handleMouseUp = useCallback((e: MouseEvent) => {
    // Prevent selection handling while highlights are being rehydrated
    if (isApplyingHighlightsRef.current) {
      return;
    }

    // If mark click was handled, don't process as text selection
    if (markClickHandledRef.current) {
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    // Check if click is on a highlight (mark element) - if so, don't process as text selection
    // The click handler will handle mark clicks
    const target = e.target as HTMLElement;
    const clickedMark = target.closest('mark') as HTMLElement | null;

    if (clickedMark) {
      // Don't process as text selection - let handleMarkClick handle it
      // But we need to wait a bit to see if click event fires
      return;
    }

    // Small delay to ensure selection is stable for regular text selection
    setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        setShowTooltip(false);
        setSelection(null);
        setClickedHighlight(null);
        return;
      }

      const range = selection.getRangeAt(0);
      
      // Check if container exists and selection is within it
      if (!container || !container.contains(range.commonAncestorContainer)) {
        setShowTooltip(false);
        setSelection(null);
        setClickedHighlight(null);
        return;
      }

      const selectedText = selection.toString().trim();
      if (selectedText.length === 0) {
        setShowTooltip(false);
        setSelection(null);
        setClickedHighlight(null);
        return;
      }

      // Get the plain text content (without HTML tags) for validation
      const containerText = container.textContent || '';
      
      if (containerText.length === 0) {
        setShowTooltip(false);
        setSelection(null);
        setClickedHighlight(null);
        return;
      }
      
      // Calculate offsets - this works even if selection includes highlighted text
      const start = calculateTextOffset(container, range.startContainer, range.startOffset);
      const end = calculateTextOffset(container, range.endContainer, range.endOffset);

      // Validate offsets
      if (start < 0 || end < 0 || start >= containerText.length || end > containerText.length || start >= end) {
        console.warn('[Highlighter] Invalid selection offsets:', { start, end, textLength: containerText.length });
        setShowTooltip(false);
        setSelection(null);
        setClickedHighlight(null);
        return;
      }

      // Check if selection is within an existing highlight
      const clickedHighlight = findHighlightAtPoint(start);
      setClickedHighlight(clickedHighlight);
      setSelection({ start, end });

      // Show tooltip near selection
      const rect = range.getBoundingClientRect();
      setTooltipPosition({
        x: rect.left + rect.width / 2,
        y: rect.top - 10,
      });
      setShowTooltip(true);
    }, 10); // Small delay to ensure DOM is stable
  }, [findHighlightAtPoint, getHighlightRangeFromMark]);

  /**
   * Handle highlight button click
   */
  const handleHighlight = useCallback((color: HighlightColor) => {
    if (selection && !isApplyingHighlightsRef.current) {
      // Clear selection first to prevent conflicts
      window.getSelection()?.removeAllRanges();
      
      // Call the highlight callback
      onHighlight(selection.start, selection.end, color);
      
      // Clear UI state
      setShowTooltip(false);
      setSelection(null);
    }
  }, [selection, onHighlight]);

  /**
   * Handle unhighlight button click
   */
  const handleUnhighlight = useCallback(() => {
    if (clickedHighlight && onRemoveHighlight && !isApplyingHighlightsRef.current) {
      // Clear selection first
      window.getSelection()?.removeAllRanges();
      
      // Remove the specific highlight that was clicked
      onRemoveHighlight(clickedHighlight.start, clickedHighlight.end);
      
      // Clear UI state
      setShowTooltip(false);
      setSelection(null);
      setClickedHighlight(null);
    }
  }, [clickedHighlight, onRemoveHighlight]);


  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      // Add click handler for mark elements (highlighted text) - use capture phase to catch early
      const clickHandler = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        // Check if click is on a mark element or inside one
        const clickedMark = target.closest('mark') as HTMLElement | null;
        
        if (clickedMark) {
          console.log('[Highlighter] Click detected on mark element');
          handleMarkClick(e);
        }
      };
      
      container.addEventListener('click', clickHandler as EventListener, true); // Capture phase
      // Add mouseup handler for text selection
      container.addEventListener('mouseup', handleMouseUp as EventListener);

      return () => {
        container.removeEventListener('click', clickHandler as EventListener, true);
        container.removeEventListener('mouseup', handleMouseUp as EventListener);
      };
    }
  }, [handleMouseUp, handleMarkClick]);

  return (
    <div className={`${styles.container} ${className}`} ref={containerRef}>
      {children}
      
      {/* Highlight Tooltip */}
      {(showTooltip && (selection || clickedHighlight)) && (
        <div
          className={styles.tooltip}
          style={{
            left: `${tooltipPosition.x}px`,
            top: `${tooltipPosition.y}px`,
          }}
        >
          <div className={styles.tooltipContent}>
            {/* Show color picker only when NOT clicking on existing highlight */}
            {!clickedHighlight && (
              <div className={styles.colorPicker}>
                <button
                  className={`${styles.colorButton} ${selectedColor === 'yellow' ? styles.colorButtonActive : ''}`}
                  onClick={() => setSelectedColor('yellow')}
                  title="Yellow highlight"
                  style={{ backgroundColor: '#fef08a' }}
                />
                <button
                  className={`${styles.colorButton} ${selectedColor === 'blue' ? styles.colorButtonActive : ''}`}
                  onClick={() => setSelectedColor('blue')}
                  title="Light blue highlight"
                  style={{ backgroundColor: '#bfdbfe' }}
                />
              </div>
            )}
            <div className={styles.tooltipButtons}>
              {/* Show Highlight button only when NOT clicking on existing highlight */}
              {!clickedHighlight && (
                <Button
                  size="sm"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleHighlight(selectedColor);
                  }}
                  className={styles.highlightButton}
                >
                  Highlight
                </Button>
              )}
              {/* Show Unhighlight button only when clicking on existing highlight */}
              {onRemoveHighlight && clickedHighlight && (
                <Button
                  size="sm"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleUnhighlight();
                  }}
                  variant="outline"
                  className={styles.unhighlightButton}
                >
                  Unhighlight
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
