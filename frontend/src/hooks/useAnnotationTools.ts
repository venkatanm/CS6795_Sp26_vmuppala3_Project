'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { db, AnnotationRecord } from '@/src/lib/db';

export type HighlightColor = 'yellow' | 'blue';

export interface HighlightRange {
  start: number;
  end: number;
  color?: HighlightColor; // Default to 'yellow' if not specified
}

interface AnnotationData {
  eliminatedOptions: (string | number)[];
  highlights: HighlightRange[];
}

/**
 * Hook for managing annotation tools (Answer Eliminator and Text Highlighter)
 * 
 * Features:
 * - Answer Eliminator: Strikethrough answer choices
 * - Text Highlighter: Highlight text in passages
 * - Persistence: Saves annotations to IndexedDB
 * - Rehydration: Restores annotations on component load
 */
export function useAnnotationTools(sessionId: string, questionId: string) {
  const [isEliminatorMode, setIsEliminatorMode] = useState(false);
  const [eliminatedOptions, setEliminatedOptions] = useState<(string | number)[]>([]);
  const [highlights, setHighlights] = useState<HighlightRange[]>([]);
  const [isMarkedForReview, setIsMarkedForReview] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const passageRef = useRef<HTMLElement | null>(null);

  // Load annotations from IndexedDB on mount
  useEffect(() => {
    const loadAnnotations = async () => {
      try {
        const annotation = await db.annotations.get([sessionId, questionId]);
        if (annotation) {
          setEliminatedOptions(annotation.eliminatedOptions || []);
          setHighlights(annotation.highlights || []);
          setIsMarkedForReview(annotation.markedForReview || false);
        }
        setIsLoaded(true);
      } catch (error) {
        console.error('[AnnotationTools] Error loading annotations:', error);
        setIsLoaded(true);
      }
    };

    if (sessionId && questionId) {
      loadAnnotations();
    }
  }, [sessionId, questionId]);

  // Save annotations to IndexedDB
  const saveAnnotations = useCallback(
    async (data: AnnotationData & { markedForReview?: boolean }) => {
      try {
        const record: AnnotationRecord = {
          sessionId,
          questionId,
          eliminatedOptions: data.eliminatedOptions,
          highlights: data.highlights,
          markedForReview: data.markedForReview !== undefined ? data.markedForReview : isMarkedForReview,
          updatedAt: Date.now(),
        };
        await db.annotations.put(record);
      } catch (error) {
        console.error('[AnnotationTools] Error saving annotations:', error);
      }
    },
    [sessionId, questionId, isMarkedForReview]
  );

  // Toggle eliminator mode
  const toggleEliminatorMode = useCallback(() => {
    setIsEliminatorMode((prev) => !prev);
  }, []);

  // Eliminate an option (toggle strikethrough)
  const toggleElimination = useCallback(
    (optionId: string | number) => {
      setEliminatedOptions((prev) => {
        const newEliminated = prev.includes(optionId)
          ? prev.filter((id) => id !== optionId)
          : [...prev, optionId];

        // Save to IndexedDB
        saveAnnotations({
          eliminatedOptions: newEliminated,
          highlights,
        });

        return newEliminated;
      });
    },
    [highlights, saveAnnotations]
  );

  // Add a highlight
  const addHighlight = useCallback(
    (start: number, end: number, color: HighlightColor = 'yellow') => {
      // Validate range
      if (start >= end || start < 0) {
        return;
      }

      setHighlights((prev) => {
        // Add the new highlight - it will be merged with overlapping ones of the same color
        // This allows users to extend existing highlights by selecting a larger range
        const newHighlights = [...prev, { start, end, color }].sort((a, b) => a.start - b.start);
        
        // Merge overlapping and adjacent ranges of the same color
        // This handles cases where user selects a larger portion that includes existing highlights
        const merged: HighlightRange[] = [];
        for (const range of newHighlights) {
          if (merged.length === 0) {
            merged.push({ ...range });
          } else {
            const last = merged[merged.length - 1];
            // Merge if overlapping or adjacent (within 1 character) AND same color
            if (range.start <= last.end + 1 && (range.color || 'yellow') === (last.color || 'yellow')) {
              // Overlapping or adjacent with same color, merge to create larger highlight
              last.end = Math.max(last.end, range.end);
            } else {
              merged.push({ ...range });
            }
          }
        }

        // Save to IndexedDB
        saveAnnotations({
          eliminatedOptions,
          highlights: merged,
        });

        return merged;
      });
    },
    [eliminatedOptions, saveAnnotations]
  );

  // Remove a highlight
  const removeHighlight = useCallback(
    (start: number, end: number) => {
      setHighlights((prev) => {
        const newHighlights = prev.filter(
          (h) => !(h.start === start && h.end === end)
        );

        // Save to IndexedDB
        saveAnnotations({
          eliminatedOptions,
          highlights: newHighlights,
        });

        return newHighlights;
      });
    },
    [eliminatedOptions, saveAnnotations]
  );

  // Toggle mark for review
  const toggleMarkForReview = useCallback(async () => {
    const newValue = !isMarkedForReview;
    setIsMarkedForReview(newValue);
    
    // Save to IndexedDB
    await saveAnnotations({
      eliminatedOptions,
      highlights,
      markedForReview: newValue,
    });
  }, [isMarkedForReview, eliminatedOptions, highlights, saveAnnotations]);

  // Keyboard shortcut for eliminator mode (Ctrl+Alt+E)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.key === 'e') {
        e.preventDefault();
        toggleEliminatorMode();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [toggleEliminatorMode]);

  // Set passage ref for highlighter
  const setPassageRef = useCallback((ref: HTMLElement | null) => {
    passageRef.current = ref;
  }, []);

  return {
    // Eliminator
    isEliminatorMode,
    toggleEliminatorMode,
    eliminatedOptions,
    toggleElimination,
    isEliminated: (optionId: string | number) => eliminatedOptions.includes(optionId),

    // Highlighter
    highlights,
    addHighlight,
    removeHighlight,
    setPassageRef,
    passageRef,

    // Mark for Review
    isMarkedForReview,
    toggleMarkForReview,

    // State
    isLoaded,
  };
}
