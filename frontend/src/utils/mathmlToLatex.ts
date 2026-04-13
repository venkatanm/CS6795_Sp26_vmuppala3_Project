/**
 * Utility to convert MathML to LaTeX for rendering with KaTeX
 */

/**
 * Converts MathML to LaTeX notation
 * Handles common MathML elements: mi, mn, mo, msup, mfenced, mfrac, etc.
 */
export function mathmlToLatex(mathml: string): string {
  // Create a temporary DOM element to parse the MathML
  const parser = new DOMParser();
  const doc = parser.parseFromString(mathml, 'text/xml');
  const mathElement = doc.querySelector('math');
  
  if (!mathElement) {
    return mathml; // Return original if no math element found
  }
  
  return convertMathElement(mathElement);
}

function convertMathElement(element: Element): string {
  const tagName = element.tagName.toLowerCase();
  
  switch (tagName) {
    case 'math':
      // Process all children
      return Array.from(element.childNodes)
        .map(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            return convertMathElement(node as Element);
          } else if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent?.trim() || '';
          }
          return '';
        })
        .filter(s => s)
        .join('');
    
    case 'mi':
      // Identifier (variable)
      return element.textContent || '';
    
    case 'mn':
      // Number
      return element.textContent || '';
    
    case 'mo':
      // Operator
      const op = element.textContent || '';
      // Convert special operators
      if (op === '=') return '=';
      if (op === '+') return '+';
      if (op === '-') return '-';
      if (op === '×' || op === '*') return '\\times';
      if (op === '÷' || op === '/') return '\\div';
      if (op === '≤') return '\\leq';
      if (op === '≥') return '\\geq';
      if (op === '<') return '<';
      if (op === '>') return '>';
      return op;
    
    case 'msup':
      // Superscript: <msup><base>...</base><sup>...</sup></msup>
      const base = element.querySelector(':scope > *:first-child');
      const sup = element.querySelector(':scope > *:last-child');
      const baseLatex = base ? convertMathElement(base) : '';
      const supLatex = sup ? convertMathElement(sup) : '';
      return `${baseLatex}^{${supLatex}}`;
    
    case 'msub':
      // Subscript
      const baseSub = element.querySelector(':scope > *:first-child');
      const sub = element.querySelector(':scope > *:last-child');
      const baseSubLatex = baseSub ? convertMathElement(baseSub) : '';
      const subLatex = sub ? convertMathElement(sub) : '';
      return `${baseSubLatex}_{${subLatex}}`;
    
    case 'mfenced':
      // Fenced expression (parentheses, brackets, etc.)
      const open = element.getAttribute('open') || '(';
      const close = element.getAttribute('close') || ')';
      const children = Array.from(element.childNodes)
        .filter(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            return true;
          }
          // Include text nodes that aren't just whitespace
          if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent?.trim() || false;
          }
          return false;
        })
        .map(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            return convertMathElement(node as Element);
          } else if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent?.trim() || '';
          }
          return '';
        })
        .filter(s => s)
        .join('');
      // Use open/close from mfenced attribute (default to parentheses)
      const openChar = open === '[' ? '[' : open === '{' ? '\\{' : '(';
      const closeChar = close === ']' ? ']' : close === '}' ? '\\}' : ')';
      return `${openChar}${children}${closeChar}`;
    
    case 'mfrac':
      // Fraction
      const num = element.querySelector(':scope > *:first-child');
      const den = element.querySelector(':scope > *:last-child');
      const numLatex = num ? convertMathElement(num) : '';
      const denLatex = den ? convertMathElement(den) : '';
      return `\\frac{${numLatex}}{${denLatex}}`;
    
    case 'mrow':
      // Row (grouping)
      return Array.from(element.childNodes)
        .map(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            return convertMathElement(node as Element);
          } else if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent?.trim() || '';
          }
          return '';
        })
        .filter(s => s)
        .join('');
    
    default:
      // For unknown elements, try to extract text content
      return element.textContent || '';
  }
}

/**
 * Converts image alt text to LaTeX notation
 */
function convertAltTextToLatex(altText: string): string {
  if (!altText) return '';
  
  let latex = altText;
  
  // Convert common patterns from alt text to LaTeX
  latex = latex.replace(/open parenthesis/gi, '(');
  latex = latex.replace(/close parenthesis/gi, ')');
  latex = latex.replace(/left parenthesis/gi, '(');
  latex = latex.replace(/right parenthesis/gi, ')');
  latex = latex.replace(/open bracket/gi, '[');
  latex = latex.replace(/close bracket/gi, ']');
  latex = latex.replace(/left bracket/gi, '[');
  latex = latex.replace(/right bracket/gi, ']');
  latex = latex.replace(/\s*times\s*/gi, ' \\times ');
  latex = latex.replace(/\s*plus\s*/gi, ' + ');
  latex = latex.replace(/\s*minus\s*/gi, ' - ');
  latex = latex.replace(/\s*equals\s*/gi, ' = ');
  latex = latex.replace(/\s*comma\s*/gi, ', ');
  
  // Clean up extra spaces
  latex = latex.replace(/\s+/g, ' ').trim();
  
  return latex;
}

/**
 * Processes HTML content and converts MathML tags to LaTeX delimiters
 * Also handles image-based math expressions by extracting alt text
 * Replaces <math>...</math> with \( ... \) for inline math
 * Replaces <img role="math"> with LaTeX from alt text
 * Strips HTML tags and preserves text content
 */
export function processMathMLInHTML(html: string): string {
  if (!html || typeof html !== 'string') {
    return html;
  }
  
  // First, convert MathML to LaTeX
  const mathRegex = /<math[^>]*>([\s\S]*?)<\/math>/gi;
  let processed = html.replace(mathRegex, (match) => {
    try {
      const latex = mathmlToLatex(match);
      // Wrap in inline math delimiters
      return `\\(${latex}\\)`;
    } catch (error) {
      console.warn('[processMathMLInHTML] Error converting MathML:', error, match);
      return match; // Return original if conversion fails
    }
  });
  
  // Extract alt text from math images and convert to LaTeX
  const imgRegex = /<img[^>]*role=["']math["'][^>]*alt=["']([^"']*)["'][^>]*>/gi;
  processed = processed.replace(imgRegex, (match, altText) => {
    if (altText) {
      const latex = convertAltTextToLatex(altText);
      if (latex) {
        return `\\(${latex}\\)`;
      }
    }
    return ''; // Remove image if no alt text
  });
  
  // Also handle images with class="math-img"
  const mathImgRegex = /<img[^>]*class=["'][^"']*math-img[^"']*["'][^>]*alt=["']([^"']*)["'][^>]*>/gi;
  processed = processed.replace(mathImgRegex, (match, altText) => {
    if (altText) {
      const latex = convertAltTextToLatex(altText);
      if (latex) {
        return `\\(${latex}\\)`;
      }
    }
    return ''; // Remove image if no alt text
  });
  
  // Strip remaining HTML tags but preserve img, svg, figure (graphs/diagrams)
  // Graph questions use <img src="data:..."> for coordinate graphs - these must not be stripped
  processed = processed.replace(/<(?!\/?(?:img|svg|figure)\b)[^>]+>/gi, '');
  
  // Decode HTML entities (client-side only)
  if (typeof document !== 'undefined') {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = processed;
    processed = textarea.value;
  } else {
    // Server-side fallback: basic entity decoding
    processed = processed
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }
  
  return processed;
}
