'use client';

import { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

interface MathRendererProps {
  /** Text content that may contain math expressions */
  children: string;

  /** Optional className */
  className?: string;

  /**
   * When true, non-math text segments are rendered via dangerouslySetInnerHTML
   * instead of as plain text. Use for question_text and choices which are HTML strings.
   */
  allowHtml?: boolean;
}

/**
 * MathRenderer Component
 * 
 * High-performance math rendering using KaTeX.
 * Supports both inline math `\( ... \)` and block math `\[ ... \]`.
 * 
 * Performance optimizations:
 * - KaTeX CSS loaded in head to prevent CLS (Cumulative Layout Shift)
 * - Parses text once and memoizes result
 * - Only processes math delimiters, leaves plain text untouched
 */
export default function MathRenderer({ children, className = '', allowHtml = false }: MathRendererProps) {
  const renderedContent = useMemo(() => {
    if (!children || typeof children !== 'string') {
      return <span>{children}</span>;
    }

    const parts: Array<{ type: 'text' | 'inline' | 'block'; content: string }> = [];
    let remaining = children;
    let lastIndex = 0;

    // Find all math expressions
    // Block math: \[ ... \]
    const blockMathRegex = /\\\[([\s\S]*?)\\\]/g;
    // Inline math: \( ... \)
    const inlineMathRegex = /\\\(([\s\S]*?)\\\)/g;

    const matches: Array<{ start: number; end: number; type: 'inline' | 'block'; content: string }> = [];

    // Find block math
    let match;
    blockMathRegex.lastIndex = 0;
    while ((match = blockMathRegex.exec(children)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        type: 'block',
        content: match[1],
      });
    }

    // Find inline math (avoiding overlaps with block math)
    inlineMathRegex.lastIndex = 0;
    while ((match = inlineMathRegex.exec(children)) !== null) {
      const overlaps = matches.some(
        (m) =>
          (match!.index >= m.start && match!.index < m.end) ||
          (match!.index + match![0].length > m.start && match!.index + match![0].length <= m.end) ||
          (match!.index < m.start && match!.index + match![0].length > m.end)
      );
      if (!overlaps) {
        matches.push({
          start: match.index,
          end: match.index + match[0].length,
          type: 'inline',
          content: match[1],
        });
      }
    }

    // Sort matches by position
    matches.sort((a, b) => a.start - b.start);

    // Build parts array
    for (const mathMatch of matches) {
      // Add text before math
      if (mathMatch.start > lastIndex) {
        const textContent = children.substring(lastIndex, mathMatch.start);
        if (textContent) {
          parts.push({ type: 'text', content: textContent });
        }
      }

      // Add math
      parts.push({ type: mathMatch.type, content: mathMatch.content });
      lastIndex = mathMatch.end;
    }

    // Add remaining text
    if (lastIndex < children.length) {
      const textContent = children.substring(lastIndex);
      if (textContent) {
        parts.push({ type: 'text', content: textContent });
      }
    }

    // If no math found, return content (may include img/svg/figure for graph questions, or HTML)
    if (parts.length === 0 || matches.length === 0) {
      const hasHtml = allowHtml || /<(?:img|svg|figure)\b/i.test(children);
      if (hasHtml) {
        return <span className={className} dangerouslySetInnerHTML={{ __html: children }} />;
      }
      return <span className={className}>{children}</span>;
    }

    // Render parts
    return (
      <span className={className}>
        {parts.map((part, index) => {
          if (part.type === 'text') {
            // Render as HTML if allowHtml is set or content contains known HTML elements
            const hasHtml = allowHtml || /<(?:img|svg|figure)\b/i.test(part.content);
            return hasHtml ? (
              <span key={index} dangerouslySetInnerHTML={{ __html: part.content }} />
            ) : (
              <span key={index}>{part.content}</span>
            );
          }

          try {
            // Render math with KaTeX
            const html = katex.renderToString(part.content, {
              throwOnError: false,
              displayMode: part.type === 'block',
            });

            if (part.type === 'block') {
              return (
                <div
                  key={index}
                  className="my-4"
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              );
            } else {
              return (
                <span
                  key={index}
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              );
            }
          } catch (error) {
            // Fallback to plain text if KaTeX fails
            console.warn('[MathRenderer] KaTeX rendering error:', error);
            return (
              <span key={index} className="text-red-500">
                {part.type === 'block' ? `\\[${part.content}\\]` : `\\(${part.content}\\)`}
              </span>
            );
          }
        })}
      </span>
    );
  }, [children, className]);

  return renderedContent;
}
