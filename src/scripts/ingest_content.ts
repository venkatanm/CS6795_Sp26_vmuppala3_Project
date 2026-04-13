/**
 * Curriculum Content Ingestion Script
 * 
 * Ingests PDF content into curriculum_chunks table with embeddings.
 * 
 * Stream A (Math PDF): High trust, direct chunk -> embed -> insert
 * Stream B (Watermarked Book): Filter practice tests, clean with Gemini, parallelize, audit, embed -> insert
 */

import { Client } from "pg";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import * as dotenv from "dotenv";
import { cleanPDFText, hasWatermark } from "../utils/text_cleaner.js";
/**
 * Clean a text chunk using Gemini 2.5 Flash Lite
 */
async function cleanChunkWithLLM(text: string): Promise<string> {
  if (!text || text.trim().length === 0) {
    return text;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not found in environment variables");
  }

  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-lite",
    generationConfig: {
      temperature: 0.1,
      topP: 0.9,
    },
  });

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
    const result = await model.generateContent(systemPrompt + "\n\n" + userPrompt);
    const response = await result.response;
    return response.text().trim();
  } catch (error) {
    console.error("❌ Error cleaning text with Gemini:", error);
    return text;
  }
}

/**
 * Audit cleaned text to check if watermark survived
 */
function auditWatermark(cleanedText: string): boolean {
  if (!cleanedText) {
    return false;
  }
  
  const watermarkPatterns = [
    /VIETACCEPTED/i,
    /VIET\s*ACCEPTED/i,
    /SAT\s*IELTS/i,
  ];

  return watermarkPatterns.some(pattern => pattern.test(cleanedText));
}

// ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve project root (two levels up from src/scripts/)
const projectRoot = path.resolve(__dirname, "../..");

// Load environment variables from project root
dotenv.config({ path: path.join(projectRoot, ".env") });

// Database connection
const dbClient = new Client({
  connectionString: process.env.DATABASE_URL?.replace("+asyncpg", ""), // Remove asyncpg for sync client
});

// Gemini client for embeddings
let genAI: any;
const EMBEDDING_MODEL = "text-embedding-004";
const EMBEDDING_DIM = 768; // Gemini text-embedding dimension

async function initializeGemini() {
  if (!genAI) {
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY not found in environment variables");
    }
    genAI = new GoogleGenerativeAI(apiKey);
  }
  return genAI;
}

/**
 * Extract text from PDF page-by-page using pdf-parse
 * Returns array of page texts for better processing
 */
async function extractPDFPages(pdfPath: string): Promise<Array<{ pageNum: number; text: string }>> {
  // Check if file exists
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`PDF file not found: ${pdfPath}`);
  }
  
  const fileStats = fs.statSync(pdfPath);
  console.log(`   📁 PDF file size: ${(fileStats.size / 1024 / 1024).toFixed(2)} MB`);
  
  const pdfParse = await import("pdf-parse");
  const pdfBuffer = fs.readFileSync(pdfPath);
  const data = await pdfParse.default(pdfBuffer);
  
  console.log(`   📄 PDF pages: ${data.numpages}`);
  console.log(`   📝 Total extracted text length: ${data.text.length} characters`);
  
  // Try to extract page-by-page if available
  const pages: Array<{ pageNum: number; text: string }> = [];
  
  if (data.text && data.text.length > 0) {
    // pdf-parse doesn't always give us page-by-page, so we'll process the whole text
    pages.push({ pageNum: 1, text: data.text });
  } else {
    console.warn(`   ⚠️  No text extracted from PDF. This may be an image-based (scanned) PDF.`);
  }
  
  // Warn if text extraction seems incomplete
  if (data.text.length < 1000 && data.numpages > 10) {
    const charsPerPage = data.text.length / data.numpages;
    console.warn(`   ⚠️  WARNING: Very little text extracted (${data.text.length} chars) from ${data.numpages} pages.`);
    console.warn(`   ⚠️  Average: ${charsPerPage.toFixed(1)} characters per page (expected: 2000-5000+).`);
    console.warn(`   ⚠️  Attempting to extract what we can with improved cleaning...`);
  }
  
  return pages;
}

/**
 * Extract full text from PDF (legacy function for Stream A)
 */
async function extractTextFromPDF(pdfPath: string): Promise<string> {
  const pages = await extractPDFPages(pdfPath);
  return pages.map(p => p.text).join("\n\n");
}

/**
 * Chunk text by concept (approximately 1000 tokens)
 * Simple chunking strategy: split by paragraphs, combine until ~1000 tokens
 */
function chunkByConcept(text: string, targetTokens: number = 1000): string[] {
  // Rough estimate: 1 token ≈ 4 characters
  const targetChars = targetTokens * 4;
  const minChunkSize = 200; // Minimum chunk size to avoid tiny header-only chunks
  
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  const chunks: string[] = [];
  let currentChunk = "";

  for (const paragraph of paragraphs) {
    // Skip very short paragraphs that are likely just headers
    if (paragraph.trim().length < 50 && currentChunk.length > 0) {
      // If it's a short paragraph and we have content, add it to current chunk
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

  // Only add final chunk if it meets minimum size
  if (currentChunk.trim().length >= minChunkSize) {
    chunks.push(currentChunk.trim());
  } else if (currentChunk.trim().length > 0 && chunks.length > 0) {
    // If final chunk is small, append it to the last chunk
    chunks[chunks.length - 1] += "\n\n" + currentChunk.trim();
  }

  return chunks;
}

/**
 * Generate embedding for text using Gemini
 */
async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const client = await initializeGemini();
    const model = client.getGenerativeModel({ model: EMBEDDING_MODEL });
    const result = await model.embedContent(text);
    return result.embedding.values; // Returns a 768-length array
  } catch (error) {
    console.error("❌ Error generating embedding:", error);
    return null;
  }
}

/**
 * Insert chunk into curriculum_chunks table
 * Uses ON CONFLICT to handle duplicates (based on content hash or source+chunk_index)
 */
async function insertChunk(
  content: string,
  embedding: number[],
  skillId: string | null = null,
  sourceType: string | null = null,
  source: string | null = null,
  metadata: Record<string, any> | null = null
): Promise<void> {
  // Convert embedding array to pgvector format string
  // pgvector expects format: '[0.1,0.2,0.3,...]'
  const embeddingStr = `[${embedding.join(",")}]`;

  // Use content hash as a simple deduplication key
  // If same content from same source exists, update it instead of inserting duplicate
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
 * Stream A: Process Math PDF (High Trust)
 * Chunk -> Embed -> Insert (no cleaning needed)
 */
async function streamA_MathPDF(pdfPath: string): Promise<number> {
  console.log("📚 Stream A: Processing Math PDF (High Trust)...");
  console.log(`   File: ${path.basename(pdfPath)}`);

  const text = await extractTextFromPDF(pdfPath);
  const chunks = chunkByConcept(text);

  console.log(`   📦 Created ${chunks.length} chunks`);

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
      "pedagogy", // source_type (as per instructions)
      path.basename(pdfPath), // source
      { chunk_index: i, stream: "A", trust_level: "high" } // metadata
    );

    inserted++;
    console.log(`   ✓ Inserted chunk ${i + 1}/${chunks.length}`);
  }

  console.log(`✅ Stream A complete: ${inserted}/${chunks.length} chunks inserted`);
  return inserted;
}

/**
 * Stream B: Process Watermarked Book
 * Process page-by-page -> Filter practice tests -> Clean -> Chunk -> Embed -> Insert
 */
async function streamB_WatermarkedBook(pdfPath: string): Promise<number> {
  console.log("📚 Stream B: Processing Watermarked Book...");
  console.log(`   File: ${path.basename(pdfPath)}`);

  // Extract pages
  const pages = await extractPDFPages(pdfPath);
  console.log(`   📄 Extracted ${pages.length} page(s) from PDF`);

  // Filter: Skip pages containing "Practice Test" AND "Questions"
  const practiceTestPattern = /(?:Practice\s+Test|Practice\s+Exam|Sample\s+Test).*Questions/i;
  const filteredPages: Array<{ pageNum: number; text: string }> = [];
  
  for (const page of pages) {
    // Check if page contains practice test markers
    if (practiceTestPattern.test(page.text)) {
      console.log(`   ⏭️  Skipping page ${page.pageNum} (Practice Test detected)`);
      continue;
    }
    
    // Clean the page text using the text cleaner utility
    const cleanedText = cleanPDFText(page.text);
    
    // Safety check: If watermark still present after cleaning, skip
    if (hasWatermark(cleanedText)) {
      console.warn(`   ⚠️  Page ${page.pageNum}: Watermark detected after cleaning - skipping`);
      continue;
    }
    
    // Only include pages with substantial content
    if (cleanedText.trim().length < 50) {
      console.log(`   ⏭️  Skipping page ${page.pageNum} (too short: ${cleanedText.trim().length} chars)`);
      continue;
    }
    
    filteredPages.push({ pageNum: page.pageNum, text: cleanedText });
  }
  
  console.log(`   🔍 Filtered: ${filteredPages.length}/${pages.length} pages kept (removed practice tests)`);
  
  // Combine all filtered pages into one text
  const filteredText = filteredPages.map(p => p.text).join("\n\n");
  console.log(`   📝 Total filtered text: ${filteredText.length} characters`);

  // Chunk the filtered text by concept
  const allChunks = chunkByConcept(filteredText, 1000);
  console.log(`   📦 Created ${allChunks.length} chunks from filtered text`);
  
  // Log first 3 cleaned chunks for verification
  console.log("\n   📋 First 3 cleaned chunks preview:");
  for (let i = 0; i < Math.min(3, allChunks.length); i++) {
    const preview = allChunks[i].substring(0, 300);
    console.log(`   Chunk ${i + 1} (${allChunks[i].length} chars): ${preview}...`);
  }
  console.log();

  // Parallelize: Process 20 chunks at a time
  const BATCH_SIZE = 20;
  let inserted = 0;
  let watermarkFailures = 0;

  for (let batchStart = 0; batchStart < allChunks.length; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, allChunks.length);
    const batch = allChunks.slice(batchStart, batchEnd);
    
    console.log(`   🔄 Processing batch ${Math.floor(batchStart / BATCH_SIZE) + 1} (chunks ${batchStart + 1}-${batchEnd})...`);

    // Clean chunks in parallel
    const cleanedChunks = await Promise.all(
      batch.map(chunk => cleanChunkWithLLM(chunk))
    );

    // Audit: Check for watermark survival
    for (let i = 0; i < cleanedChunks.length; i++) {
      if (auditWatermark(cleanedChunks[i])) {
        console.warn(`   ⚠️  Watermark detected in chunk ${batchStart + i + 1} - skipping`);
        watermarkFailures++;
        continue;
      }

      // Generate embedding
      const embedding = await generateEmbedding(cleanedChunks[i]);
      if (!embedding) {
        console.warn(`   ⚠️  Skipping chunk ${batchStart + i + 1} (embedding failed)`);
        continue;
      }

      // Insert
      await insertChunk(
        cleanedChunks[i],
        embedding,
        null, // skill_id
        "reference", // source_type (as per instructions: 'reference' for the book)
        path.basename(pdfPath), // source
        { 
          chunk_index: batchStart + i, 
          stream: "B", 
          trust_level: "cleaned",
          original_length: batch[i].length,
          cleaned_length: cleanedChunks[i].length
        } // metadata
      );

      inserted++;
    }

    console.log(`   ✓ Batch complete: ${inserted} chunks inserted so far`);
  }

  console.log(`✅ Stream B complete: ${inserted}/${allChunks.length} chunks inserted`);
  if (watermarkFailures > 0) {
    console.log(`⚠️  ${watermarkFailures} chunks failed watermark audit`);
  }
  return inserted;
}

/**
 * Main execution
 */
async function main() {
  try {
    // Check for command-line argument to skip Stream A
    const skipStreamA = process.argv.includes("--stream-b-only") || process.argv.includes("--skip-stream-a");
    
    console.log("🚀 Starting Curriculum Content Ingestion\n");

    // Connect to database
    console.log("🔌 Connecting to database...");
    await dbClient.connect();
    console.log("✅ Connected to database\n");

    // Resolve PDF paths
    const mathPdfPath = path.join(projectRoot, "data", "sat-suite-classroom-practice-math.pdf");
    const studyGuidePath = path.join(projectRoot, "data", "Official Digital Study Guide.pdf.pdf");

    // Verify files exist
    if (!fs.existsSync(studyGuidePath)) {
      throw new Error(`Study Guide PDF not found: ${studyGuidePath}`);
    }

    let streamACount = 0;
    let streamBCount = 0;

    // Stream A: Math PDF (High Trust) - Skip if flag is set
    if (!skipStreamA) {
      if (!fs.existsSync(mathPdfPath)) {
        throw new Error(`Math PDF not found: ${mathPdfPath}`);
      }
      console.log("=".repeat(60));
      streamACount = await streamA_MathPDF(mathPdfPath);
      console.log();
    } else {
      console.log("⏭️  Skipping Stream A (Math PDF) - Stream B only mode\n");
    }

    // Stream B: Watermarked Book
    // Optionally delete existing Stream B chunks before rerunning
    if (skipStreamA && process.argv.includes("--clean-stream-b")) {
      console.log("🧹 Cleaning existing Stream B chunks...");
      const deleteResult = await dbClient.query(
        `DELETE FROM curriculum_chunks WHERE source = $1 AND (metadata->>'stream' = 'B' OR metadata->>'stream' IS NULL)`,
        [path.basename(studyGuidePath)]
      );
      console.log(`✅ Cleaned existing Stream B chunks\n`);
    }
    
    console.log("=".repeat(60));
    streamBCount = await streamB_WatermarkedBook(studyGuidePath);
    console.log();

    // Summary
    console.log("=".repeat(60));
    console.log("📊 Ingestion Summary:");
    if (!skipStreamA) {
      console.log(`   Stream A (Math PDF): ${streamACount} chunks`);
    }
    console.log(`   Stream B (Watermarked Book): ${streamBCount} chunks`);
    console.log(`   Total: ${streamACount + streamBCount} chunks`);
    console.log("\n✅ Ingestion complete!");

  } catch (error) {
    console.error("❌ Error during ingestion:", error);
    process.exit(1);
  } finally {
    await dbClient.end();
  }
}

// Run the ingestion
main();
