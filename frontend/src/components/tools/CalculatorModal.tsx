'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Move, Calculator, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import styles from './CalculatorModal.module.css';

interface CalculatorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type CalculatorMode = 'graphing' | 'scientific';

/**
 * CalculatorModal Component
 * 
 * Draggable modal containing Desmos Graphing and Scientific Calculator.
 * Matches Bluebook's calculator interface with mode switching.
 */
export default function CalculatorModal({ isOpen, onClose }: CalculatorModalProps) {
  const calculatorRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const calculatorInstanceRef = useRef<any>(null);
  const scriptRef = useRef<HTMLScriptElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [position, setPosition] = useState({ x: 100, y: 100 });
  const [size, setSize] = useState({ 
    width: 600, 
    height: 500 
  });
  const [mode, setMode] = useState<CalculatorMode>('graphing');
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const resizeStartRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  // Initialize calculator based on mode
  const initializeCalculator = () => {
    if (!calculatorRef.current || !(window as any).Desmos) return;

    // Destroy existing calculator instance
    if (calculatorInstanceRef.current) {
      try {
        calculatorInstanceRef.current.destroy();
      } catch (e) {
        // Ignore destroy errors
      }
      calculatorInstanceRef.current = null;
    }

    // Clear the container
    calculatorRef.current.innerHTML = '';

    // Initialize based on mode
    if (mode === 'graphing') {
      calculatorInstanceRef.current = (window as any).Desmos.GraphingCalculator(calculatorRef.current, {
        keypad: true,
        expressions: true,
        settingsMenu: true,
        zoomButtons: true,
        lockViewport: false,
      });
    } else {
      // Scientific Calculator
      calculatorInstanceRef.current = (window as any).Desmos.ScientificCalculator(calculatorRef.current, {
        keypad: true,
        pasteGraphLink: false,
      });
    }
  };

  // Load Desmos API script (only once)
  useEffect(() => {
    if (!isOpen) {
      // Cleanup when closed
      if (calculatorInstanceRef.current) {
        try {
          calculatorInstanceRef.current.destroy();
        } catch (e) {
          // Ignore destroy errors
        }
        calculatorInstanceRef.current = null;
      }
      return;
    }

    // Check if script already exists
    const existingScript = document.querySelector('script[src*="desmos.com/api"]');
    if (existingScript) {
      // Script already loaded, initialize calculator
      if ((window as any).Desmos && calculatorRef.current) {
        // Small delay to ensure DOM is ready
        setTimeout(() => {
          initializeCalculator();
        }, 100);
      }
      return;
    }

    // Load Desmos API
    const script = document.createElement('script');
    script.src = `https://www.desmos.com/api/v1.9/calculator.js?apiKey=${process.env.NEXT_PUBLIC_DESMOS_API_KEY || 'dcb31709b452b1cf9dc26972add0fda6'}`;
    script.async = true;
    scriptRef.current = script;

    script.onload = () => {
      if (calculatorRef.current && (window as any).Desmos) {
        initializeCalculator();
      }
    };

    document.body.appendChild(script);

    return () => {
      // Cleanup calculator instance
      if (calculatorInstanceRef.current) {
        try {
          calculatorInstanceRef.current.destroy();
        } catch (e) {
          // Ignore destroy errors
        }
        calculatorInstanceRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Re-initialize calculator when mode changes
  useEffect(() => {
    if (isOpen && (window as any).Desmos && calculatorRef.current) {
      initializeCalculator();
      // Update default size based on mode
      setSize({
        width: mode === 'graphing' ? 600 : 400,
        height: 500
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Resize Desmos calculator when container size changes
  useEffect(() => {
    if (calculatorInstanceRef.current && (window as any).Desmos) {
      // Desmos calculator needs to be resized when container size changes
      try {
        calculatorInstanceRef.current.resize();
      } catch (e) {
        // Ignore resize errors
      }
    }
  }, [size.width, size.height]);

  // Handle dragging
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    setIsDragging(true);
    const rect = containerRef.current.getBoundingClientRect();
    dragStartRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging || !dragStartRef.current) return;
    setPosition({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    dragStartRef.current = null;
  };

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging]);

  // Handle resizing
  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!containerRef.current) return;
    setIsResizing(true);
    const rect = containerRef.current.getBoundingClientRect();
    resizeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      width: rect.width,
      height: rect.height,
    };
  };

  const handleResizeMouseMove = (e: MouseEvent) => {
    if (!isResizing || !resizeStartRef.current || !containerRef.current) return;
    
    const deltaX = e.clientX - resizeStartRef.current.x;
    const deltaY = e.clientY - resizeStartRef.current.y;
    
    // Minimum size constraints
    const minWidth = 300;
    const minHeight = 300;
    
    // Maximum size constraints - ensure modal doesn't go outside viewport
    const rect = containerRef.current.getBoundingClientRect();
    const maxWidth = window.innerWidth - rect.left;
    const maxHeight = window.innerHeight - rect.top;
    
    const newWidth = Math.max(minWidth, Math.min(maxWidth, resizeStartRef.current.width + deltaX));
    const newHeight = Math.max(minHeight, Math.min(maxHeight, resizeStartRef.current.height + deltaY));
    
    setSize({
      width: newWidth,
      height: newHeight,
    });
  };

  const handleResizeMouseUp = () => {
    setIsResizing(false);
    resizeStartRef.current = null;
  };

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleResizeMouseMove);
      document.addEventListener('mouseup', handleResizeMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleResizeMouseMove);
        document.removeEventListener('mouseup', handleResizeMouseUp);
      };
    }
  }, [isResizing]);

  if (!isOpen) return null;

  return (
    <div
      ref={containerRef}
      className={styles.modal}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: `${size.width}px`,
        height: `${size.height}px`,
      }}
    >
      {/* Bluebook-style Dark Header */}
      <div className={styles.header} onMouseDown={handleMouseDown}>
        <div className={styles.headerLeft}>
          {/* Mode Toggle Buttons */}
          <button
            className={`${styles.modeButton} ${mode === 'graphing' ? styles.modeButtonActive : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setMode('graphing');
            }}
            type="button"
          >
            <TrendingUp className="h-4 w-4 mr-1.5" />
            Graphing
          </button>
          <button
            className={`${styles.modeButton} ${mode === 'scientific' ? styles.modeButtonActive : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setMode('scientific');
            }}
            type="button"
          >
            <Calculator className="h-4 w-4 mr-1.5" />
            Scientific
          </button>
        </div>
        <div className={styles.headerActions}>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className={styles.headerButton}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className={styles.content}>
        <div ref={calculatorRef} className={styles.calculator} />
      </div>
      
      {/* Resize Handle */}
      <div 
        className={styles.resizeHandle}
        onMouseDown={handleResizeMouseDown}
        style={{ cursor: isResizing ? 'nwse-resize' : 'nwse-resize' }}
      />
    </div>
  );
}
