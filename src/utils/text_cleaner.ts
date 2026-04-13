/**
 * Text Cleaner Utility
 * Cleans PDF-extracted text by removing watermarks, fixing formatting, and preserving math notation.
 */

/**
 * Clean PDF-extracted text
 * - Removes watermarks
 * - Removes headers/footers
 * - Fixes broken words (hyphens across lines)
 * - Preserves LaTeX/math notation
 */
export function cleanPDFText(text: string): string {
  if (!text || text.trim().length === 0) {
    return text;
  }

  let cleaned = text;

  // 1. Remove watermark patterns
  cleaned = cleaned.replace(/VIETACCEPTED\s+SAT\s+IELTS/gi, "");
  cleaned = cleaned.replace(/VIET\s*ACCEPTED/gi, "");
  cleaned = cleaned.replace(/SAT\s*IELTS/gi, "");

  // 2. Remove copyright headers/footers
  cleaned = cleaned.replace(/Copyright.*College Board/gi, "");
  cleaned = cleaned.replace(/©.*College Board/gi, "");
  cleaned = cleaned.replace(/College Board.*All rights reserved/gi, "");

  // 3. Fix broken words (hyphens across newlines)
  // Pattern: word-\nword -> wordword
  cleaned = cleaned.replace(/([a-zA-Z])-\s*\n\s*([a-zA-Z])/g, "$1$2");
  // Pattern: word\nword (without hyphen) -> word word
  cleaned = cleaned.replace(/([a-zA-Z])\s*\n\s*([a-zA-Z])/g, "$1 $2");

  // 4. Normalize whitespace (but preserve intentional line breaks in math)
  // Replace multiple newlines with double newline (paragraph break)
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  // Replace single newlines with space (unless followed by math symbols)
  cleaned = cleaned.replace(/([^\n$\\])\n([^\n$\\])/g, "$1 $2");
  // Clean up multiple spaces
  cleaned = cleaned.replace(/[ \t]+/g, " ");

  // 5. Preserve LaTeX/math notation (don't touch content between $ or with \)
  // This is handled by being careful with the regex above

  // 6. Trim and return
  return cleaned.trim();
}

/**
 * Check if text contains watermark (safety check)
 */
export function hasWatermark(text: string): boolean {
  if (!text) return false;
  
  const watermarkPatterns = [
    /VIETACCEPTED/i,
    /VIET\s*ACCEPTED/i,
    /SAT\s*IELTS/i,
  ];
  
  return watermarkPatterns.some(pattern => pattern.test(text));
}
