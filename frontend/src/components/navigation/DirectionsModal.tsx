'use client';

import { X } from 'lucide-react';
import styles from './DirectionsModal.module.css';

interface DirectionsModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  
  /** Callback to close the modal */
  onClose: () => void;
  
  /** Section name (e.g., "Section 1: Reading and Writing" or "Section 2: Math") */
  sectionName: string;
}

/**
 * Section-specific instructions
 */
const SECTION_INSTRUCTIONS: Record<string, string> = {
  'Reading and Writing': `The questions in this section address a number of important reading and writing skills. Each question includes one or more passages, which may include a table or graph. Read each passage and question carefully, and then choose the best answer to the question based on the passage(s).

All questions in this section are multiple-choice with four answer choices. Each question has a single best answer.`,
  
  'Math': `The questions in this section address a number of important math skills. Some questions include one or more passages, tables, or graphs. Read each question carefully, and then choose the best answer to the question based on the information provided.

All questions in this section are multiple-choice with four answer choices. Each question has a single best answer. Some questions are student-produced response questions (also called grid-in questions) where you'll enter your answer in a grid.`,
};

/**
 * Extract section type from section name
 * Examples:
 * - "Section 1: Reading and Writing" -> "Reading and Writing"
 * - "Section 2: Math" -> "Math"
 */
function getSectionType(sectionName: string): string {
  // Try to match common patterns
  if (sectionName.toLowerCase().includes('reading') || sectionName.toLowerCase().includes('writing')) {
    return 'Reading and Writing';
  }
  if (sectionName.toLowerCase().includes('math')) {
    return 'Math';
  }
  // Default to Reading and Writing
  return 'Reading and Writing';
}

/**
 * DirectionsModal Component
 * 
 * Bluebook-style modal displaying section-specific instructions.
 * Shows a large modal with instructional text and a yellow "Close" button.
 */
export default function DirectionsModal({
  isOpen,
  onClose,
  sectionName,
}: DirectionsModalProps) {
  if (!isOpen) return null;

  const sectionType = getSectionType(sectionName);
  const instructions = SECTION_INSTRUCTIONS[sectionType] || SECTION_INSTRUCTIONS['Reading and Writing'];

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalContent}>
          <div className={styles.instructionsText}>
            {instructions}
          </div>
        </div>
        <div className={styles.modalFooter}>
          <button
            onClick={onClose}
            className={styles.closeButton}
            aria-label="Close directions"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
