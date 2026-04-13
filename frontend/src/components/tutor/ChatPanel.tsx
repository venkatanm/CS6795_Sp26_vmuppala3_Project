'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { X, Send, Loader2, ImagePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTutorSession, ChatMessage } from '@/src/hooks/useTutorSession';
import ThinkingIndicator, { ThinkingState } from '@/src/components/chat/ThinkingIndicator';
import MathRenderer from '@/src/components/math/MathRenderer';
import styles from './ChatPanel.module.css';

export interface CurrentQuestion {
  /** Question ID */
  id: string;
  /** Question text/stem */
  text: string;
  /** Answer choices */
  choices?: Array<{ id: string; text: string }>;
  /** Correct answer */
  correctAnswer?: string;
  /** Official explanation */
  explanation?: string;
  /** Skill tags */
  skillTags?: string | string[];
}

export interface ChatPanelProps {
  /** Whether the panel is open */
  isOpen: boolean;
  /** Callback when panel is closed */
  onClose: () => void;
  /** Question ID for context */
  questionId: string;
  /** Session ID */
  sessionId: string;
  /** Student's wrong answer (for context) */
  studentAnswer?: string | number;
  /** Question text (for display) - DEPRECATED: use currentQuestion instead */
  questionText?: string;
  /** Current question context (includes id, text, choices, correctAnswer, explanation, skillTags) */
  currentQuestion?: CurrentQuestion;
  /** Mode: 'default' or 'daily' (shows Next Question button) */
  mode?: 'default' | 'daily';
  /** Callback for Next Question button (daily mode only) */
  onNextQuestion?: () => void;
  /** Initial message to send automatically (optional) */
  initialMessage?: string;
}

/**
 * ChatPanel Component
 * 
 * Slide-out chat panel for AI Tutor that maintains context of the specific question.
 * 
 * Features:
 * - Slide-over animation from right
 * - Streaming responses (token by token)
 * - Saves chat history to IndexedDB
 * - Context-aware initialization with questionId and studentAnswer
 */
export default function ChatPanel({
  isOpen,
  onClose,
  questionId,
  sessionId,
  studentAnswer,
  questionText,
  currentQuestion,
  mode = 'default',
  onNextQuestion,
  initialMessage,
}: ChatPanelProps) {
  const [inputValue, setInputValue] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    state,
    sendMessage,
    initializeSession,
    clearSession,
    thinkingState,
  } = useTutorSession(currentQuestion);

  // Initialize session when panel opens
  useEffect(() => {
    if (isOpen && questionId && sessionId) {
      initializeSession(questionId, sessionId, studentAnswer);
    }

    // Clear session when panel closes
    return () => {
      if (!isOpen) {
        clearSession();
      }
    };
  }, [isOpen, questionId, sessionId, studentAnswer, initializeSession, clearSession]);

  // Send initial message if provided (for daily mode)
  useEffect(() => {
    if (isOpen && initialMessage && state.isInitialized && state.messages.length === 0) {
      // Small delay to ensure session is fully initialized
      const timer = setTimeout(() => {
        sendMessage(initialMessage).catch(console.error);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen, initialMessage, state.isInitialized, state.messages.length, sendMessage]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [state.messages, state.isStreaming]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      // Small delay to ensure panel is fully rendered
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  // Handle escape key to close
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      alert('Image size must be less than 10MB');
      return;
    }

    // Create preview
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      setSelectedImage(base64String);
      setImagePreview(base64String);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleClearImage = useCallback(() => {
    setSelectedImage(null);
    setImagePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleSend = useCallback(async () => {
    const message = inputValue.trim();
    if ((!message && !selectedImage) || state.isStreaming) {
      return;
    }

    // Convert image to base64 if needed (remove data URL prefix if present)
    let imageBase64: string | undefined = undefined;
    if (selectedImage) {
      // Remove data URL prefix if present (e.g., "data:image/jpeg;base64,")
      imageBase64 = selectedImage.includes(',') 
        ? selectedImage.split(',')[1] 
        : selectedImage;
    }

    setInputValue('');
    setSelectedImage(null);
    setImagePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    await sendMessage(message || 'Analyze this image', imageBase64);
  }, [inputValue, selectedImage, state.isStreaming, sendMessage]);

  const handleKeyPress = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const formatMessage = (content: string) => {
    // Convert dollar sign math delimiters to LaTeX format for MathRenderer
    // $...$ -> \(...\) for inline math
    // $$...$$ -> \[...\] for block math
    const convertDollarToLatex = (text: string): string => {
      // First, handle block math $$...$$
      let converted = text.replace(/\$\$([^$]+)\$\$/g, '\\[$1\\]');
      
      // Then handle inline math $...$ (but avoid currency like $70, $100)
      // Only convert if it looks like math (contains operators, variables, etc.)
      converted = converted.replace(/\$([^$\n]+?)\$/g, (match, mathContent) => {
        const trimmed = mathContent.trim();
        
        // Check if it's likely currency:
        // - Starts with digit or comma+digit (e.g., $70, $2,500)
        // - OR is just a number with optional decimal (e.g., $3.50)
        if (/^[\d,]+(\.\d+)?$/.test(trimmed)) {
          return match; // Keep as-is (currency)
        }
        
        // Check if it contains math-like content (operators, variables, parentheses, etc.)
        // This includes: +, -, *, /, =, (, ), {, }, [, ], ^, _, \, letters (variables)
        if (/[+\-*/=(){}[\]^_\\a-zA-Z]/.test(mathContent)) {
          return `\\(${mathContent}\\)`; // Convert to LaTeX inline math
        }
        
        return match; // Keep as-is if doesn't look like math
      });
      
      return converted;
    };
    
    // Split by newlines and render each line with math support
    const lines = content.split('\n');
    return lines.map((line, i) => {
      const convertedLine = convertDollarToLatex(line);
      return (
        <span key={i}>
          <MathRenderer>{convertedLine}</MathRenderer>
          {i < lines.length - 1 && <br />}
        </span>
      );
    });
  };

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className={styles.backdrop}
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Slide-over Panel */}
      <div
        ref={panelRef}
        className={`${styles.panel} ${isOpen ? styles.open : ''}`}
        role="dialog"
        aria-labelledby="chat-panel-title"
        aria-modal="true"
      >
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerContent}>
            <h2 id="chat-panel-title" className={styles.title}>
              {mode === 'daily' ? "Let's debug this" : 'AI Tutor'}
            </h2>
            {(currentQuestion?.text || questionText) && (
              <p className={styles.questionPreview}>
                {(() => {
                  const text = currentQuestion?.text || questionText || '';
                  return text.length > 50 ? `${text.substring(0, 50)}...` : text;
                })()}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Next Question button (daily mode only) */}
            {mode === 'daily' && onNextQuestion && (
              <Button
                variant="default"
                size="sm"
                onClick={onNextQuestion}
                className="bg-blue-600 hover:bg-blue-700 text-white"
                aria-label="Next Question"
              >
                Next Question
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className={styles.closeButton}
              aria-label="Close chat panel"
            >
              <X size={20} />
            </Button>
          </div>
        </div>

        {/* Messages Container */}
        <div className={styles.messagesContainer}>
          {state.messages.length === 0 && !state.isStreaming && (
            <div className={styles.emptyState}>
              <p>Start a conversation with your AI tutor!</p>
              <p className={styles.emptyStateHint}>
                Ask questions about the problem, and I'll guide you through solving it.
              </p>
            </div>
          )}

          {state.messages.map((message: ChatMessage, index: number) => (
            <div
              key={index}
              className={`${styles.message} ${
                message.role === 'student' ? styles.studentMessage : styles.tutorMessage
              }`}
            >
              <div className={styles.messageContent}>
                {formatMessage(message.content)}
              </div>
              <div className={styles.messageTimestamp}>
                {new Date(message.timestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
            </div>
          ))}

          {/* Thinking Indicator */}
          {thinkingState && thinkingState !== 'idle' && (
            <ThinkingIndicator
              state={thinkingState}
              visible={true}
            />
          )}

          {state.isStreaming && (
            <div className={`${styles.message} ${styles.tutorMessage} ${styles.streaming}`}>
              <div className={styles.messageContent}>
                {formatMessage(state.messages[state.messages.length - 1]?.content || '')}
                <span className={styles.cursor}>▋</span>
              </div>
            </div>
          )}

          {state.error && (
            <div className={styles.errorMessage}>
              <p>Error: {state.error}</p>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Image Preview */}
        {imagePreview && (
          <div className="px-4 py-2 border-b border-gray-200 bg-gray-50">
            <div className="flex items-center gap-2 bg-white rounded-lg p-2 shadow-sm border border-gray-200">
              <img
                src={imagePreview}
                alt="Preview"
                className="w-16 h-16 object-cover rounded"
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-600 truncate">Image selected</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleClearImage}
                className="h-8 w-8 text-gray-500 hover:text-gray-700"
                aria-label="Remove image"
              >
                <X size={16} />
              </Button>
            </div>
          </div>
        )}

        {/* Input Area */}
        <div className={styles.inputArea}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
            aria-label="Upload image"
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            disabled={state.isStreaming}
            className="flex-shrink-0 text-gray-500 hover:text-gray-700"
            aria-label="Upload image"
          >
            <ImagePlus size={20} />
          </Button>
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            onKeyDown={(e) => {
              // Handle Enter key
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={state.isInitialized ? "Ask a question..." : "Initializing..."}
            disabled={state.isStreaming}
            className={styles.input}
            aria-label="Message input"
            autoFocus={isOpen}
            readOnly={!state.isInitialized}
          />
          <Button
            onClick={handleSend}
            disabled={(!inputValue.trim() && !selectedImage) || state.isStreaming}
            className={styles.sendButton}
            aria-label="Send message"
          >
            {state.isStreaming ? (
              <Loader2 size={20} className={styles.spinner} />
            ) : (
              <Send size={20} />
            )}
          </Button>
        </div>
      </div>
    </>
  );
}
