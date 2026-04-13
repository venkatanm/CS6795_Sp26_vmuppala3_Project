'use client';

import { memo, useMemo } from 'react';

// Conditionally import Latex only when needed to avoid processing plain text
let LatexComponent: any = null;

const getLatexComponent = () => {
  if (!LatexComponent) {
    LatexComponent = require('react-latex-next').default;
  }
  return LatexComponent;
};

interface MathTextProps {
  children: string;
}

interface ParsedPart {
  text: string;
  isMath: boolean;
}

/**
 * Component that only renders LaTeX when math delimiters are present,
 * otherwise renders plain text to avoid text distortion.
 * 
 * Performance Optimizations:
 * - Memoized to prevent re-parsing LaTeX when text hasn't changed
 * - useMemo caches the parsed parts array
 * - Only re-parses when children prop actually changes
 * 
 * This component completely avoids using LaTeX for plain text to prevent
 * any text processing that could cause distortion.
 */
const MathText = memo<MathTextProps>(({ children }) => {
  // Memoize the parsing logic to avoid re-parsing unchanged text
  const parsedParts = useMemo<ParsedPart[] | null>(() => {
    if (!children || typeof children !== 'string') {
      return null;
    }

    // First, unescape dollar signs that are used for currency (not LaTeX math)
    // Replace \$ followed by a digit (currency) with $
    // This handles cases like \$2,500, \$35, \$70
    let processedText = children.replace(/\\\$(\d)/g, (match, digit) => '$' + digit);
    
    // Split text into math and non-math parts to prevent LaTeX from processing regular text
    // This prevents distortion of regular text
    const parts: Array<{ text: string; isMath: boolean }> = [];
    
    // Find display math: $$...$$
    const displayMathRegex = /\$\$[^$]{1,200}\$\$/g;
    
    // Find inline math: $...$ where it's clearly math (contains operators, variables, etc.)
    // NOT currency: $ followed by digit or comma+digit
    // Must have math-like content (operators, parentheses, variables)
    const inlineMathRegex = /\$(?![\d,])[^$]*[+\-*/=(){}[\]^_\\a-zA-Z][^$]*\$/g;
    
    // Collect all math matches
    const mathMatches: Array<{ start: number; end: number; isDisplay: boolean }> = [];
    
    // Find display math
    let match;
    displayMathRegex.lastIndex = 0;
    while ((match = displayMathRegex.exec(processedText)) !== null) {
      mathMatches.push({ start: match.index, end: match.index + match[0].length, isDisplay: true });
    }
    
    // Find inline math (avoiding overlaps with display math)
    inlineMathRegex.lastIndex = 0;
    while ((match = inlineMathRegex.exec(processedText)) !== null) {
      const overlaps = mathMatches.some(m => 
        (match!.index >= m.start && match!.index < m.end) ||
        (match!.index + match![0].length > m.start && match!.index + match![0].length <= m.end) ||
        (match!.index < m.start && match!.index + match![0].length > m.end)
      );
      if (!overlaps) {
        mathMatches.push({ start: match.index, end: match.index + match[0].length, isDisplay: false });
      }
    }
    
    // Sort by position
    mathMatches.sort((a, b) => a.start - b.start);
    
    // Build parts array
    let lastIndex = 0;
    for (const mathMatch of mathMatches) {
      // Add text before math
      if (mathMatch.start > lastIndex) {
        parts.push({ text: processedText.substring(lastIndex, mathMatch.start), isMath: false });
      }
      // Add math
      parts.push({ text: processedText.substring(mathMatch.start, mathMatch.end), isMath: true });
      lastIndex = mathMatch.end;
    }
    
    // Add remaining text
    if (lastIndex < processedText.length) {
      parts.push({ text: processedText.substring(lastIndex), isMath: false });
    }
    
    // If no math found, return null to indicate plain text
    if (parts.length === 0 || !mathMatches.length) {
      return null; // Signal plain text
    }
    
    return parts;
  }, [children]);

  // Handle null/undefined children
  if (!children || typeof children !== 'string') {
    return <span>{children}</span>;
  }

  // If no math found, render as plain text (no LaTeX parsing needed)
  if (parsedParts === null) {
    // Re-process text for currency unescaping only
    const processedText = children.replace(/\\\$(\d)/g, (match, digit) => '$' + digit);
    return <span style={{ whiteSpace: 'pre-line' }}>{processedText}</span>;
  }
  
  // Render: math with LaTeX, text as plain
  const Latex = getLatexComponent();
  return (
    <span style={{ whiteSpace: 'pre-line' }}>
      {parsedParts.map((part, index) => {
        if (part.isMath) {
          return (
            <Latex 
              key={index}
              delimiters={[
                { left: '$$', right: '$$', display: part.text.startsWith('$$') },
                { left: '$', right: '$', display: false }
              ]}
            >
              {part.text}
            </Latex>
          );
        } else {
          return <span key={index}>{part.text}</span>;
        }
      })}
    </span>
  );
}, (prevProps, nextProps) => {
  // Custom comparison: only re-render if children actually changes
  return prevProps.children === nextProps.children;
});

MathText.displayName = 'MathText';

export default MathText;
