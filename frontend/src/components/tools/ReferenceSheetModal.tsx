'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import MathRenderer from '../math/MathRenderer';
import styles from './ReferenceSheetModal.module.css';

interface ReferenceSheetModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * ReferenceSheetModal Component
 * 
 * Draggable modal displaying the standard SAT Math reference sheet
 * with formulas and diagrams, matching Bluebook's reference sheet.
 */
export default function ReferenceSheetModal({ isOpen, onClose }: ReferenceSheetModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState({ x: 100, y: 100 });
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

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

  if (!isOpen) return null;

  return (
    <div
      ref={containerRef}
      className={styles.modal}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: '700px',
        height: '600px',
      }}
    >
      {/* Bluebook-style Dark Header */}
      <div className={styles.header} onMouseDown={handleMouseDown}>
        <div className={styles.headerLeft}>
          <span className={styles.headerTitle}>Reference Sheet</span>
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

      {/* Content Body */}
      <div className={styles.content}>
        {/* Row 1: Basic Area/Volume/Pythagorean */}
        <div className={styles.row1}>
          {/* Circle */}
          <div className={styles.formulaItem}>
            <svg className={styles.diagram} viewBox="0 0 80 80">
              <circle cx="40" cy="40" r="30" fill="none" stroke="#1a1a1a" strokeWidth="2" />
              <line x1="40" y1="40" x2="70" y2="40" stroke="#1a1a1a" strokeWidth="1.5" />
              <text x="55" y="35" fontSize="12" fill="#1a1a1a">r</text>
            </svg>
            <div className={styles.formula}>
              <MathRenderer>{'\\(A = \\pi r^2\\)'}</MathRenderer>
            </div>
            <div className={styles.formula}>
              <MathRenderer>{'\\(C = 2\\pi r\\)'}</MathRenderer>
            </div>
          </div>

          {/* Rectangle */}
          <div className={styles.formulaItem}>
            <svg className={styles.diagram} viewBox="0 0 80 80">
              <rect x="15" y="20" width="50" height="40" fill="none" stroke="#1a1a1a" strokeWidth="2" />
              <text x="20" y="15" fontSize="12" fill="#1a1a1a">l</text>
              <text x="70" y="45" fontSize="12" fill="#1a1a1a">w</text>
            </svg>
            <div className={styles.formula}>
              <MathRenderer>{'\\(A = lw\\)'}</MathRenderer>
            </div>
          </div>

          {/* Triangle */}
          <div className={styles.formulaItem}>
            <svg className={styles.diagram} viewBox="0 0 80 80">
              <polygon points="40,15 15,65 65,65" fill="none" stroke="#1a1a1a" strokeWidth="2" />
              <line x1="40" y1="15" x2="40" y2="65" stroke="#1a1a1a" strokeWidth="1.5" strokeDasharray="2,2" />
              <text x="45" y="45" fontSize="12" fill="#1a1a1a">h</text>
              <text x="10" y="70" fontSize="12" fill="#1a1a1a">b</text>
            </svg>
            <div className={styles.formula}>
              <MathRenderer>{'\\(A = \\frac{1}{2}bh\\)'}</MathRenderer>
            </div>
          </div>

          {/* Pythagorean Theorem */}
          <div className={styles.formulaItem}>
            <svg className={styles.diagram} viewBox="0 0 80 80">
              <polygon points="15,15 15,65 65,65" fill="none" stroke="#1a1a1a" strokeWidth="2" />
              <text x="10" y="40" fontSize="12" fill="#1a1a1a">a</text>
              <text x="40" y="70" fontSize="12" fill="#1a1a1a">b</text>
              <text x="25" y="30" fontSize="12" fill="#1a1a1a">c</text>
            </svg>
            <div className={styles.formula}>
              <MathRenderer>{'\\(c^2 = a^2 + b^2\\)'}</MathRenderer>
            </div>
          </div>

          {/* Empty spacing */}
          <div className={styles.formulaItem}></div>
        </div>

        {/* Row 2: Special Right Triangles */}
        <div className={styles.row2}>
          <div className={styles.specialTrianglesHeader}>
            <h3 className={styles.sectionTitle}>Special Right Triangles</h3>
          </div>
          <div className={styles.specialTriangles}>
            {/* 30-60-90 Triangle */}
            <div className={styles.triangleItem}>
              <svg className={styles.triangleDiagram} viewBox="0 0 120 100">
                <polygon points="60,10 10,90 110,90" fill="none" stroke="#1a1a1a" strokeWidth="2" />
                <text x="35" y="50" fontSize="10" fill="#1a1a1a">30°</text>
                <text x="75" y="50" fontSize="10" fill="#1a1a1a">60°</text>
                <line x1="60" y1="10" x2="60" y2="90" stroke="#1a1a1a" strokeWidth="1" strokeDasharray="2,2" />
                <text x="65" y="55" fontSize="10" fill="#1a1a1a">x√3</text>
                <text x="25" y="55" fontSize="10" fill="#1a1a1a">x</text>
                <text x="50" y="5" fontSize="10" fill="#1a1a1a">2x</text>
              </svg>
              <div className={styles.triangleLabels}>
                <div><MathRenderer>{'\\(2x\\)'}</MathRenderer> (hypotenuse)</div>
                <div><MathRenderer>{'\\(x\\)'}</MathRenderer> (short leg)</div>
                <div><MathRenderer>{'\\(x\\sqrt{3}\\)'}</MathRenderer> (long leg)</div>
              </div>
            </div>

            {/* 45-45-90 Triangle */}
            <div className={styles.triangleItem}>
              <svg className={styles.triangleDiagram} viewBox="0 0 120 100">
                <polygon points="10,10 10,90 90,90" fill="none" stroke="#1a1a1a" strokeWidth="2" />
                <text x="20" y="50" fontSize="10" fill="#1a1a1a">45°</text>
                <text x="50" y="85" fontSize="10" fill="#1a1a1a">45°</text>
                <text x="15" y="30" fontSize="10" fill="#1a1a1a">s</text>
                <text x="50" y="70" fontSize="10" fill="#1a1a1a">s</text>
                <text x="30" y="5" fontSize="10" fill="#1a1a1a">s√2</text>
              </svg>
              <div className={styles.triangleLabels}>
                <div><MathRenderer>{'\\(s\\)'}</MathRenderer> (legs)</div>
                <div><MathRenderer>{'\\(s\\sqrt{2}\\)'}</MathRenderer> (hypotenuse)</div>
              </div>
            </div>
          </div>
        </div>

        {/* Row 3: 3D Volume */}
        <div className={styles.row3}>
          {/* Rectangular Prism */}
          <div className={styles.formulaItem}>
            <svg className={styles.diagram3d} viewBox="0 0 80 80">
              <rect x="20" y="15" width="40" height="30" fill="none" stroke="#1a1a1a" strokeWidth="2" />
              <polygon points="20,15 30,10 70,10 60,15" fill="none" stroke="#1a1a1a" strokeWidth="2" />
              <line x1="30" y1="10" x2="30" y2="45" stroke="#1a1a1a" strokeWidth="2" />
              <line x1="70" y1="10" x2="60" y2="15" stroke="#1a1a1a" strokeWidth="2" />
              <text x="25" y="10" fontSize="10" fill="#1a1a1a">h</text>
              <text x="45" y="30" fontSize="10" fill="#1a1a1a">w</text>
              <text x="65" y="20" fontSize="10" fill="#1a1a1a">l</text>
            </svg>
            <div className={styles.formula}>
              <MathRenderer>{'\\(V = lwh\\)'}</MathRenderer>
            </div>
          </div>

          {/* Cylinder */}
          <div className={styles.formulaItem}>
            <svg className={styles.diagram3d} viewBox="0 0 80 80">
              <ellipse cx="40" cy="15" rx="25" ry="8" fill="none" stroke="#1a1a1a" strokeWidth="2" />
              <ellipse cx="40" cy="65" rx="25" ry="8" fill="none" stroke="#1a1a1a" strokeWidth="2" />
              <line x1="15" y1="15" x2="15" y2="65" stroke="#1a1a1a" strokeWidth="2" />
              <line x1="65" y1="15" x2="65" y2="65" stroke="#1a1a1a" strokeWidth="2" />
              <line x1="40" y1="15" x2="40" y2="65" stroke="#1a1a1a" strokeWidth="1.5" strokeDasharray="2,2" />
              <text x="45" y="45" fontSize="10" fill="#1a1a1a">h</text>
              <text x="50" y="20" fontSize="10" fill="#1a1a1a">r</text>
            </svg>
            <div className={styles.formula}>
              <MathRenderer>{'\\(V = \\pi r^2h\\)'}</MathRenderer>
            </div>
          </div>

          {/* Sphere */}
          <div className={styles.formulaItem}>
            <svg className={styles.diagram3d} viewBox="0 0 80 80">
              <circle cx="40" cy="40" r="25" fill="none" stroke="#1a1a1a" strokeWidth="2" />
              <ellipse cx="40" cy="40" rx="25" ry="8" fill="none" stroke="#1a1a1a" strokeWidth="1.5" opacity="0.5" />
              <line x1="40" y1="15" x2="40" y2="65" stroke="#1a1a1a" strokeWidth="1.5" />
              <text x="50" y="40" fontSize="10" fill="#1a1a1a">r</text>
            </svg>
            <div className={styles.formula}>
              <MathRenderer>{'\\(V = \\frac{4}{3}\\pi r^3\\)'}</MathRenderer>
            </div>
          </div>

          {/* Cone */}
          <div className={styles.formulaItem}>
            <svg className={styles.diagram3d} viewBox="0 0 80 80">
              <ellipse cx="40" cy="65" rx="20" ry="8" fill="none" stroke="#1a1a1a" strokeWidth="2" />
              <line x1="40" y1="15" x2="20" y2="65" stroke="#1a1a1a" strokeWidth="2" />
              <line x1="40" y1="15" x2="60" y2="65" stroke="#1a1a1a" strokeWidth="2" />
              <line x1="40" y1="15" x2="40" y2="65" stroke="#1a1a1a" strokeWidth="1.5" strokeDasharray="2,2" />
              <text x="45" y="45" fontSize="10" fill="#1a1a1a">h</text>
              <text x="50" y="60" fontSize="10" fill="#1a1a1a">r</text>
            </svg>
            <div className={styles.formula}>
              <MathRenderer>{'\\(V = \\frac{1}{3}\\pi r^2h\\)'}</MathRenderer>
            </div>
          </div>

          {/* Rectangular Pyramid */}
          <div className={styles.formulaItem}>
            <svg className={styles.diagram3d} viewBox="0 0 80 80">
              <rect x="20" y="50" width="40" height="20" fill="none" stroke="#1a1a1a" strokeWidth="2" />
              <line x1="40" y1="15" x2="20" y2="50" stroke="#1a1a1a" strokeWidth="2" />
              <line x1="40" y1="15" x2="60" y2="50" stroke="#1a1a1a" strokeWidth="2" />
              <line x1="40" y1="15" x2="40" y2="50" stroke="#1a1a1a" strokeWidth="1.5" strokeDasharray="2,2" />
              <text x="45" y="35" fontSize="10" fill="#1a1a1a">h</text>
              <text x="45" y="60" fontSize="10" fill="#1a1a1a">w</text>
              <text x="65" y="60" fontSize="10" fill="#1a1a1a">l</text>
            </svg>
            <div className={styles.formula}>
              <MathRenderer>{'\\(V = \\frac{1}{3}lwh\\)'}</MathRenderer>
            </div>
          </div>
        </div>

        {/* Row 4: Text Rules */}
        <div className={styles.row4}>
          <div className={styles.textRule}>
            <MathRenderer>The number of degrees of arc in a circle is 360.</MathRenderer>
          </div>
          <div className={styles.textRule}>
            <MathRenderer>{'The number of radians of arc in a circle is \\(2\\pi\\).'}</MathRenderer>
          </div>
          <div className={styles.textRule}>
            <MathRenderer>The sum of the measures in degrees of the angles of a triangle is 180.</MathRenderer>
          </div>
        </div>
      </div>
    </div>
  );
}
