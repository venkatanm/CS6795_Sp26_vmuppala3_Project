/**
 * Stream B OCR: Process Scanned PDF (Pages 1-321) using Gemini Vision
 * 
 * This script:
 * 1. Extracts pages 1-321 from the PDF
 * 2. Converts each page to an image
 * 3. Sends to Gemini Vision API for OCR
 * 4. Cleans and processes the OCR'd text
 * 5. Chunks, embeds, and inserts into curriculum_chunks
 */

import { Client } from "pg";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import * as dotenv from "dotenv";
import { GoogleGenerativeAI, FileDataPart } from "@google/generative-ai";
import { PDFDocument } from "pdf-lib";

// ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");

dotenv.config({ path: path.join(projectRoot, ".env") });

// Database connection
const dbClient = new Client({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME || "fastapi_db",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
});

// Constants
const EMBEDDING_MODEL = "text-embedding-004";
const EMBEDDING_DIM = 768;
const MAX_PAGE = 321; // Only process pages 1-321
const BATCH_SIZE = 5; // Process 5 pages at a time for OCR

/**
 * Clean PDF-extracted text (inlined from text_cleaner.ts to avoid module resolution issues)
 * - Removes watermarks
 * - Removes headers/footers
 * - Fixes broken words (hyphens across lines)
 * - Preserves LaTeX/math notation
 */
function cleanPDFText(text: string): string {
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
 * Check if text contains watermark (safety check) - inlined from text_cleaner.ts
 */
function hasWatermark(text: string): boolean {
  if (!text) return false;
  
  const watermarkPatterns = [
    /VIETACCEPTED/i,
    /VIET\s*ACCEPTED/i,
    /SAT\s*IELTS/i,
  ];
  
  return watermarkPatterns.some(pattern => pattern.test(text));
}

// Initialize Gemini
let genAI: GoogleGenerativeAI | null = null;
function initializeGemini(): GoogleGenerativeAI {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY not found in environment variables");
    }
    genAI = new GoogleGenerativeAI(apiKey);
  }
  return genAI;
}

/**
 * Extract pages 1-321 from PDF and save as separate PDF
 */
async function extractPages1to321(pdfPath: string, outputPath: string): Promise<void> {
  console.log(`   📄 Extracting pages 1-${MAX_PAGE} from PDF...`);
  
  const pdfBytes = fs.readFileSync(pdfPath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  
  const newPdf = await PDFDocument.create();
  const pageCount = Math.min(pdfDoc.getPageCount(), MAX_PAGE);
  
  const pages = await newPdf.copyPages(pdfDoc, Array.from({ length: pageCount }, (_, i) => i));
  pages.forEach((page) => newPdf.addPage(page));
  
  const newPdfBytes = await newPdf.save();
  fs.writeFileSync(outputPath, newPdfBytes);
  
  console.log(`   ✅ Extracted ${pageCount} pages to ${path.basename(outputPath)}`);
}

/**
 * Extract a single page from PDF as a new PDF buffer
 */
async function extractSinglePageAsPDF(pdfPath: string, pageNum: number): Promise<Buffer> {
  const pdfBytes = fs.readFileSync(pdfPath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  
  // Create a single-page PDF
  const singlePagePdf = await PDFDocument.create();
  const [copiedPage] = await singlePagePdf.copyPages(pdfDoc, [pageNum - 1]);
  singlePagePdf.addPage(copiedPage);
  
  const singlePageBytes = await singlePagePdf.save();
  return Buffer.from(singlePageBytes);
}

/**
 * OCR a PDF page using Gemini Vision
 */
async function ocrPageWithGemini(pageBuffer: Buffer, pageNum: number): Promise<string> {
  const genAI = initializeGemini();
  const model = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash-lite" // Using flash-lite for faster processing (same as other scripts)
  });
  
  const prompt = `Transcribe this document page into clean Markdown.

Instructions:
1. IGNORE the watermark 'VIETACCEPTED SAT IELTS' or any similar watermarks.
2. IGNORE page headers, footers, and page numbers.
3. Keep LaTeX math format intact (e.g., $x^2$, \\frac{a}{b}, etc.).
4. Preserve paragraph structure and formatting.
5. If text is illegible or unclear, skip that section.
6. Return only the transcribed text, no explanations.`;

  try {
    // Convert PDF buffer to base64 for Gemini
    const base64Pdf = pageBuffer.toString('base64');
    
    // Gemini Vision API - send PDF as inline data
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: base64Pdf,
          mimeType: "application/pdf"
        }
      }
    ]);
    
    const response = await result.response;
    const text = response.text();
    
    console.log(`   ✓ OCR'd page ${pageNum} (${text.length} chars)`);
    return text;
  } catch (error: any) {
    console.error(`   ❌ Error OCR'ing page ${pageNum}:`, error.message || error);
    // Retry once with a delay
    if (error.message?.includes('rate') || error.message?.includes('quota')) {
      console.log(`   ⏳ Rate limit hit, waiting 2 seconds before retry...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      try {
        const result = await model.generateContent([
          prompt,
          {
            inlineData: {
              data: pageBuffer.toString('base64'),
              mimeType: "application/pdf"
            }
          }
        ]);
        const response = await result.response;
        const text = response.text();
        console.log(`   ✓ OCR'd page ${pageNum} (retry successful, ${text.length} chars)`);
        return text;
      } catch (retryError: any) {
        console.error(`   ❌ Retry failed for page ${pageNum}:`, retryError.message || retryError);
        return "";
      }
    }
    return "";
  }
}

/**
 * Generate embedding using Gemini text-embedding-004
 */
async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const genAI = initializeGemini();
    const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
    const result = await model.embedContent(text);
    return result.embedding.values; // Returns a 768-length array
  } catch (error) {
    console.error("❌ Error generating embedding:", error);
    return null;
  }
}

/**
 * Insert chunk into curriculum_chunks table
 */
async function insertChunk(
  content: string,
  embedding: number[],
  skillId: string | null = null,
  sourceType: string | null = null,
  source: string | null = null,
  metadata: Record<string, any> | null = null
): Promise<void> {
  const embeddingStr = `[${embedding.join(",")}]`;

  await dbClient.query(
    `INSERT INTO curriculum_chunks (content, embedding, skill_id, source_type, source, metadata)
     VALUES ($1, $2::vector(${EMBEDDING_DIM}), $3, $4, $5, $6::jsonb)
     ON CONFLICT DO NOTHING`,
    [
      content, 
      embeddingStr, 
      skillId, 
      sourceType, 
      source, 
      metadata ? JSON.stringify(metadata) : null
    ]
  );
}

/**
 * Chunk text by concept (approximately 1000 tokens)
 */
function chunkByConcept(text: string, targetTokens: number = 1000): string[] {
  const targetChars = targetTokens * 4;
  const minChunkSize = 200;
  
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  const chunks: string[] = [];
  let currentChunk = "";

  for (const paragraph of paragraphs) {
    if (paragraph.trim().length < 50 && currentChunk.length > 0) {
      currentChunk += (currentChunk ? "\n\n" : "") + paragraph;
      continue;
    }
    
    if (currentChunk.length + paragraph.length > targetChars && currentChunk.length >= minChunkSize) {
      chunks.push(currentChunk.trim());
      currentChunk = paragraph;
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + paragraph;
    }
  }

  if (currentChunk.trim().length >= minChunkSize) {
    chunks.push(currentChunk.trim());
  } else if (currentChunk.trim().length > 0 && chunks.length > 0) {
    chunks[chunks.length - 1] += "\n\n" + currentChunk.trim();
  }

  return chunks;
}

/**
 * Main OCR processing function
 */
async function processStreamB_OCR(pdfPath: string): Promise<number> {
  console.log("📚 Stream B OCR: Processing Scanned PDF (Pages 1-321)...");
  console.log(`   File: ${path.basename(pdfPath)}`);
  console.log(`   Processing Pages 1-${MAX_PAGE} (Ignoring ${MAX_PAGE + 1}+).`);

  // Step 1: Extract pages 1-321 to a temporary PDF
  const tempPdfPath = path.join(projectRoot, "data", `temp_pages_1_${MAX_PAGE}.pdf`);
  await extractPages1to321(pdfPath, tempPdfPath);

  // Step 2: OCR each page with Gemini Vision
  console.log(`\n   🔍 Starting OCR with Gemini Vision...`);
  const allOcrTexts: Array<{ pageNum: number; text: string }> = [];
  
  // Process pages in batches
  for (let pageStart = 1; pageStart <= MAX_PAGE; pageStart += BATCH_SIZE) {
    const pageEnd = Math.min(pageStart + BATCH_SIZE - 1, MAX_PAGE);
    console.log(`   🔄 Processing pages ${pageStart}-${pageEnd}...`);
    
    const batchPromises = [];
    for (let pageNum = pageStart; pageNum <= pageEnd; pageNum++) {
      batchPromises.push(
        extractSinglePageAsPDF(tempPdfPath, pageNum)
          .then(buffer => ocrPageWithGemini(buffer, pageNum))
          .then(text => ({ pageNum, text }))
      );
    }
    
    const batchResults = await Promise.all(batchPromises);
    allOcrTexts.push(...batchResults.filter(r => r.text.length > 0));
    
    // Small delay to avoid rate limiting
    if (pageEnd < MAX_PAGE) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log(`   ✅ OCR complete: ${allOcrTexts.length} pages processed`);

  // Step 3: Clean and combine OCR'd text
  console.log(`\n   🧹 Cleaning OCR'd text...`);
  const cleanedTexts: string[] = [];
  
  for (const { pageNum, text } of allOcrTexts) {
    const cleaned = cleanPDFText(text);
    
    // Safety check: skip if watermark still present
    if (hasWatermark(cleaned)) {
      console.warn(`   ⚠️  Page ${pageNum}: Watermark detected after cleaning - skipping`);
      continue;
    }
    
    if (cleaned.trim().length < 50) {
      console.log(`   ⏭️  Skipping page ${pageNum} (too short: ${cleaned.trim().length} chars)`);
      continue;
    }
    
    cleanedTexts.push(cleaned);
  }

  const combinedText = cleanedTexts.join("\n\n");
  console.log(`   📝 Total cleaned text: ${combinedText.length} characters`);

  // Step 4: Chunk the text
  const chunks = chunkByConcept(combinedText, 1000);
  console.log(`   📦 Created ${chunks.length} chunks`);

  // Log first 3 chunks for verification
  console.log("\n   📋 First 3 cleaned chunks preview:");
  for (let i = 0; i < Math.min(3, chunks.length); i++) {
    const preview = chunks[i].substring(0, 300);
    console.log(`   Chunk ${i + 1} (${chunks[i].length} chars): ${preview}...`);
  }
  console.log();

  // Step 5: Embed and insert
  console.log(`   🔄 Embedding and inserting chunks...`);
  let inserted = 0;
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    console.log(`   🔄 Processing chunk ${i + 1}/${chunks.length}...`);

    const embedding = await generateEmbedding(chunk);
    if (!embedding) {
      console.warn(`   ⚠️  Skipping chunk ${i + 1} (embedding failed)`);
      continue;
    }

    await insertChunk(
      chunk,
      embedding,
      null, // skill_id
      "reference", // source_type
      path.basename(pdfPath), // source
      { 
        chunk_index: i, 
        stream: "B_OCR", 
        trust_level: "ocr",
        pages: `1-${MAX_PAGE}`,
        ocr_model: "gemini-2.5-flash-lite"
      } // metadata
    );

    inserted++;
    console.log(`   ✓ Inserted chunk ${i + 1}/${chunks.length}`);
  }

  // Cleanup temp file
  if (fs.existsSync(tempPdfPath)) {
    fs.unlinkSync(tempPdfPath);
    console.log(`   🗑️  Cleaned up temporary PDF`);
  }

  console.log(`✅ Stream B OCR complete: ${inserted}/${chunks.length} chunks inserted`);
  return inserted;
}

/**
 * Main execution
 */
async function main() {
  try {
    console.log("🚀 Starting Stream B OCR Ingestion\n");

    // Connect to database
    console.log("🔌 Connecting to database...");
    await dbClient.connect();
    console.log("✅ Connected to database\n");

    // Resolve PDF path - the file is "Official Digital Study Guide.pdf" (not .pdf.pdf)
    const studyGuidePath = path.join(projectRoot, "data", "Official Digital Study Guide.pdf");

    if (!fs.existsSync(studyGuidePath)) {
      throw new Error(`Study Guide PDF not found: ${studyGuidePath}`);
    }
    
    console.log(`   📁 Using PDF: ${path.basename(studyGuidePath)}`);

    // Process with OCR
    console.log("=".repeat(60));
    const inserted = await processStreamB_OCR(studyGuidePath);
    console.log();

    // Summary
    console.log("=".repeat(60));
    console.log("📊 Ingestion Summary:");
    console.log(`   Stream B OCR (Pages 1-${MAX_PAGE}): ${inserted} chunks`);
    console.log("\n✅ Ingestion complete!");

  } catch (error) {
    console.error("❌ Error during ingestion:", error);
    process.exit(1);
  } finally {
    await dbClient.end();
  }
}

// Run if executed directly
main().catch(console.error);

export { processStreamB_OCR };
