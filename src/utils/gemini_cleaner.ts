/**
 * Gemini Text Cleaner
 * 
 * Uses Gemini 2.5 Flash Lite to clean watermarked and poorly formatted text
 * from PDFs. Optimized for cost and speed.
 */

import * as path from "path";
import { fileURLToPath } from "url";

// ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dynamically import @google/generative-ai (ESM compatible)
let geminiClient: any;
const MODEL_NAME = "gemini-2.5-flash-lite";

async function initializeGemini() {
  if (!geminiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY not found in environment variables");
    }
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    geminiClient = new GoogleGenerativeAI(apiKey);
  }
  return geminiClient;
}

/**
 * Clean a text chunk using Gemini 2.5 Flash Lite
 * 
 * Removes:
 * - Watermark "VIETACCEPTED SAT IELTS"
 * - Page numbers and headers
 * - Fixes words broken by newlines
 * 
 * Preserves:
 * - LaTeX math formatting ($, \frac, etc.)
 * 
 * @param text - Raw text chunk to clean
 * @returns Cleaned text
 */
export async function cleanChunkWithLLM(text: string): Promise<string> {
  if (!text || text.trim().length === 0) {
    return text;
  }

  const systemPrompt = `You are a Text Cleaner.

Your task:
1. Remove the watermark 'VIETACCEPTED SAT IELTS' wherever it appears (case-insensitive).
2. Remove page numbers and headers like 'Chapter 4', 'Page 12', etc.
3. Fix words broken by newlines (e.g., 'func-\\ntion' -> 'function', 'equa-\\ntion' -> 'equation').
4. PRESERVE all LaTeX math formatting ($, \\frac, \\sqrt, etc.) exactly as written.
5. Remove excessive whitespace but preserve paragraph breaks.
6. Return ONLY the cleaned text, no explanations or markdown.`;

  const userPrompt = `Clean this text:

${text}`;

  try {
    const client = await initializeGemini();
    const model = client.getGenerativeModel({
      model: MODEL_NAME,
      generationConfig: {
        temperature: 0.1, // Low temperature for consistent cleaning
        topP: 0.9,
      },
    });

    const result = await model.generateContent(systemPrompt + "\n\n" + userPrompt);
    const response = await result.response;
    return response.text().trim();
  } catch (error) {
    console.error("❌ Error cleaning text with Gemini:", error);
    // Return original text if cleaning fails
    return text;
  }
}

/**
 * Audit cleaned text to check if watermark survived
 * 
 * @param cleanedText - The cleaned text to audit
 * @returns true if watermark is found (should be false)
 */
export const auditWatermark = (cleanedText: string): boolean => {
  if (!cleanedText) {
    return false;
  }
  
  const watermarkPatterns = [
    /VIETACCEPTED/i,
    /VIET\s*ACCEPTED/i,
    /SAT\s*IELTS/i,
  ];

  return watermarkPatterns.some(pattern => pattern.test(cleanedText));
};
