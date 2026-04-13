/**
 * Mine Misconceptions from Sample Questions PDF
 * 
 * This script:
 * 1. Loads the digital-sat-sample-questions.pdf
 * 2. Extracts "Answer Explanations" sections
 * 3. Uses Gemini to identify misconceptions from incorrect answer explanations
 * 4. Stores them in the misconceptions table
 */

import { Client } from "pg";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import * as dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";

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
const MODEL_NAME = "gemini-2.5-flash-lite";
const CHUNK_SIZE = 20000; // Characters per chunk for processing

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
 * Extract text from PDF using pdf-parse
 */
async function extractTextFromPDF(pdfPath: string): Promise<string> {
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`PDF file not found: ${pdfPath}`);
  }
  
  const fileStats = fs.statSync(pdfPath);
  console.log(`   📁 PDF file size: ${(fileStats.size / 1024 / 1024).toFixed(2)} MB`);
  
  const pdfParse = await import("pdf-parse");
  const pdfBuffer = fs.readFileSync(pdfPath);
  const data = await pdfParse.default(pdfBuffer);
  
  console.log(`   📄 PDF pages: ${data.numpages}`);
  console.log(`   📝 Extracted text length: ${data.text.length} characters`);
  
  return data.text;
}

/**
 * Filter text to only "Answer Explanations" sections
 */
function filterAnswerExplanations(text: string): string {
  // Look for common patterns that indicate answer explanations
  const explanationPatterns = [
    /Answer Explanations?/i,
    /Explanation:/i,
    /Why.*incorrect/i,
    /Choice [A-E] is (incorrect|wrong)/i,
  ];
  
  // Split by sections that might contain explanations
  const sections = text.split(/(?=Answer Explanations?|Explanation:|Question \d+)/i);
  
  // Filter sections that contain explanation patterns
  const explanationSections = sections.filter(section => {
    return explanationPatterns.some(pattern => pattern.test(section));
  });
  
  if (explanationSections.length === 0) {
    console.log("   ⚠️  No explicit 'Answer Explanations' section found, processing entire text");
    return text;
  }
  
  const filteredText = explanationSections.join("\n\n");
  console.log(`   🔍 Filtered to ${explanationSections.length} explanation sections (${filteredText.length} chars)`);
  
  return filteredText;
}

/**
 * Split text into chunks for processing
 */
function chunkText(text: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  
  return chunks;
}

/**
 * Extract misconceptions from text chunk using Gemini
 * Returns misconceptions with name, remediation, and error_description
 */
async function extractMisconceptions(chunk: string, chunkIndex: number): Promise<Array<{ name: string; remediation: string; error_description: string }>> {
  const genAI = initializeGemini();
  const model = genAI.getGenerativeModel({ model: MODEL_NAME });
  
  const prompt = `Analyze the following text from SAT Answer Explanations.
Find every instance where the text explains why a choice is **incorrect** (e.g., 'Choice B is incorrect because...', 'This is wrong because...', 'The student might think...but...').

For each instance:
1. **Name the Error:** Give it a short, reusable tag (e.g., 'Confused Sine/Cosine', 'Dangling Modifier', 'Calculation Error', 'Misread Graph', 'Confused Subject-Verb Agreement').
2. **Remediation:** Write a 1-sentence Socratic Question to help a student realize this mistake *without* telling them the answer. The question should guide them to discover the error themselves.
3. **Error Description:** Extract the key phrase or sentence from the explanation that describes why the choice is wrong (e.g., "The student added exponents instead of multiplying them" or "This confuses subject-verb agreement").

Return ONLY a valid JSON array in this exact format:
[
  {
    "name": "Error Name",
    "remediation": "Socratic question here?",
    "error_description": "Description of why this is wrong"
  }
]

If no misconceptions are found, return an empty array: [].

Text to analyze:
${chunk}`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    // Extract JSON from response (might have markdown code blocks)
    let jsonText = text.trim();
    
    // Remove markdown code blocks if present
    if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    }
    
    // Try to parse JSON
    const misconceptions = JSON.parse(jsonText);
    
    if (!Array.isArray(misconceptions)) {
      console.warn(`   ⚠️  Chunk ${chunkIndex + 1}: Response is not an array, skipping`);
      return [];
    }
    
    console.log(`   ✓ Chunk ${chunkIndex + 1}: Extracted ${misconceptions.length} misconceptions`);
    return misconceptions;
  } catch (error: any) {
    console.error(`   ❌ Error processing chunk ${chunkIndex + 1}:`, error.message || error);
    // Try to extract JSON even if there's an error
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const misconceptions = JSON.parse(jsonMatch[0]);
        if (Array.isArray(misconceptions)) {
          console.log(`   ✓ Chunk ${chunkIndex + 1}: Recovered ${misconceptions.length} misconceptions from error`);
          return misconceptions;
        }
      }
    } catch (e) {
      // Ignore recovery attempt errors
    }
    return [];
  }
}

/**
 * Generate embedding for misconception using Gemini text-embedding-004
 */
async function generateMisconceptionEmbedding(name: string, errorDescription: string): Promise<number[] | null> {
  try {
    const genAI = initializeGemini();
    const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
    
    // Create string to embed: "name: error_description"
    const textToEmbed = `${name}: ${errorDescription}`;
    
    const result = await embeddingModel.embedContent(textToEmbed);
    return result.embedding.values; // Returns 768-length array
  } catch (error) {
    console.error("❌ Error generating embedding:", error);
    return null;
  }
}

/**
 * Convert embedding array to pgvector format string
 */
function embeddingToVector(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

/**
 * Insert misconception into database with embedding
 */
async function insertMisconception(
  misconception: { name: string; remediation: string; error_description?: string },
  embedding: number[] | null
): Promise<boolean> {
  try {
    if (embedding) {
      const embeddingVector = embeddingToVector(embedding);
      await dbClient.query(
        `INSERT INTO misconceptions (name, remediation_text, embedding)
         VALUES ($1, $2, $3::vector(768))
         ON CONFLICT (name) DO UPDATE SET 
           remediation_text = EXCLUDED.remediation_text,
           embedding = EXCLUDED.embedding`,
        [
          misconception.name.trim(),
          misconception.remediation.trim(),
          embeddingVector
        ]
      );
    } else {
      // Insert without embedding if generation failed
      await dbClient.query(
        `INSERT INTO misconceptions (name, remediation_text)
         VALUES ($1, $2)
         ON CONFLICT (name) DO UPDATE SET remediation_text = EXCLUDED.remediation_text`,
        [
          misconception.name.trim(),
          misconception.remediation.trim()
        ]
      );
    }
    return true;
  } catch (error: any) {
    // Check if it's a duplicate (unique constraint violation)
    if (error.code === '23505') {
      return false; // Already exists
    }
    console.error(`   ❌ Error inserting misconception "${misconception.name}":`, error.message);
    return false;
  }
}

/**
 * Main mining function
 */
async function mineMisconceptions(pdfPath: string): Promise<number> {
  console.log("🔍 Starting Misconception Mining\n");
  console.log(`   File: ${path.basename(pdfPath)}`);

  // Step 1: Load PDF
  console.log("\n📄 Step 1: Loading PDF...");
  const fullText = await extractTextFromPDF(pdfPath);

  // Step 2: Filter to Answer Explanations
  console.log("\n🔍 Step 2: Filtering Answer Explanations...");
  const explanationText = filterAnswerExplanations(fullText);

  // Step 3: Split into chunks
  console.log(`\n📦 Step 3: Splitting into chunks (${CHUNK_SIZE} chars each)...`);
  const chunks = chunkText(explanationText, CHUNK_SIZE);
  console.log(`   Created ${chunks.length} chunks`);

  // Step 4: Extract misconceptions from each chunk
  console.log("\n🤖 Step 4: Extracting misconceptions with Gemini...");
  const allMisconceptions: Array<{ name: string; remediation: string; error_description?: string }> = [];
  
  for (let i = 0; i < chunks.length; i++) {
    console.log(`   🔄 Processing chunk ${i + 1}/${chunks.length}...`);
    const misconceptions = await extractMisconceptions(chunks[i], i);
    allMisconceptions.push(...misconceptions);
    
    // Small delay to avoid rate limiting
    if (i < chunks.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log(`\n✅ Extracted ${allMisconceptions.length} total misconceptions`);

  // Step 5: Generate embeddings and store
  console.log("\n💾 Step 5: Generating embeddings and storing misconceptions...");
  let inserted = 0;
  let skipped = 0;
  
  // Deduplicate by name (case-insensitive)
  const seen = new Set<string>();
  const uniqueMisconceptions = allMisconceptions.filter(m => {
    const key = m.name.toLowerCase().trim();
    if (seen.has(key)) {
      skipped++;
      return false;
    }
    seen.add(key);
    return true;
  });

  console.log(`   📊 After deduplication: ${uniqueMisconceptions.length} unique misconceptions`);

  // Generate embeddings and insert
  for (let i = 0; i < uniqueMisconceptions.length; i++) {
    const misconception = uniqueMisconceptions[i];
    console.log(`   🔄 Processing ${i + 1}/${uniqueMisconceptions.length}: "${misconception.name}"`);
    
    // Generate embedding: "name: error_description"
    const errorDescription = misconception.error_description || misconception.remediation; // Fallback to remediation if no error_description
    const embedding = await generateMisconceptionEmbedding(
      misconception.name,
      errorDescription
    );
    
    if (!embedding) {
      console.warn(`   ⚠️  Failed to generate embedding for "${misconception.name}", inserting without embedding`);
    }
    
    const success = await insertMisconception(misconception, embedding);
    if (success) {
      inserted++;
      console.log(`   ✓ Inserted: "${misconception.name}" ${embedding ? '(with embedding)' : '(no embedding)'}`);
    } else {
      skipped++;
    }
    
    // Small delay to avoid rate limiting
    if (i < uniqueMisconceptions.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  console.log(`\n✅ Mining complete: ${inserted} new misconceptions inserted, ${skipped} duplicates skipped`);
  return inserted;
}

/**
 * Main execution
 */
async function main() {
  try {
    console.log("🚀 Starting Misconception Mining from Sample Questions\n");

    // Connect to database
    console.log("🔌 Connecting to database...");
    await dbClient.connect();
    console.log("✅ Connected to database\n");

    // Resolve PDF path
    const pdfPath = path.join(projectRoot, "data", "digital-sat-sample-questions.pdf");

    if (!fs.existsSync(pdfPath)) {
      throw new Error(`PDF file not found: ${pdfPath}`);
    }

    // Mine misconceptions
    console.log("=".repeat(60));
    const inserted = await mineMisconceptions(pdfPath);
    console.log("=".repeat(60));

    // Summary
    console.log("\n📊 Final Summary:");
    console.log(`   New misconceptions inserted: ${inserted}`);
    
    // Show some examples
    const examples = await dbClient.query(
      `SELECT name, remediation_text FROM misconceptions ORDER BY id DESC LIMIT 5`
    );
    if (examples.rows.length > 0) {
      console.log("\n📋 Sample misconceptions:");
      examples.rows.forEach((row, i) => {
        console.log(`   ${i + 1}. ${row.name}`);
        console.log(`      Q: ${row.remediation_text}`);
      });
    }

    console.log("\n✅ Mining complete!");

  } catch (error) {
    console.error("❌ Error during mining:", error);
    process.exit(1);
  } finally {
    await dbClient.end();
  }
}

// Run if executed directly
main().catch(console.error);

export { mineMisconceptions };
