/**
 * Socratic Graph Taxonomy Seeder
 * 
 * This script parses SAT assessment framework PDFs and populates the knowledge graph:
 * 1. Extracts Domains and Skills from assessment-framework-for-digital-sat-suite.pdf
 * 2. Extracts Score Band descriptors from skills-insight-digital-sat-suite.pdf
 * 3. Uses Gemini 2.5 Flash Lite to parse and structure the data
 * 
 * Optimized for Gemini's large context window - processes entire PDFs in single requests
 */

import { Client } from "pg";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import * as dotenv from "dotenv";

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

// Initialize Gemini 2.5 Flash Lite
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  throw new Error("GEMINI_API_KEY not found in environment variables");
}

// Dynamically import google-genai (ESM compatible)
let geminiClient: any;
const MODEL_NAME = "gemini-2.5-flash-lite";

async function initializeGemini() {
  if (!geminiClient) {
    // Use @google/generative-ai SDK
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    geminiClient = new GoogleGenerativeAI(apiKey);
  }
  return geminiClient;
}

/**
 * Extract text from PDF using pdf-parse
 */
async function extractTextFromPDF(pdfPath: string): Promise<string> {
  const pdfParse = await import("pdf-parse");
  const pdfBuffer = fs.readFileSync(pdfPath);
  const data = await pdfParse.default(pdfBuffer);
  return data.text;
}

/**
 * Call Gemini API with optimized prompt
 */
async function callGemini(prompt: string): Promise<string> {
  try {
    const client = await initializeGemini();
    const model = client.getGenerativeModel({ 
      model: MODEL_NAME,
      generationConfig: {
        temperature: 0.1, // Low temperature for consistent extraction
        topP: 0.9,
      },
    });
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text().trim();
  } catch (error) {
    console.error("❌ Gemini API error:", error);
    throw error;
  }
}

interface Domain {
  name: string;
  weight?: number;
}

interface Skill {
  name: string;
  description: string;
  bloom_level?: string;
}

interface SkillBand {
  score_range: string;
  descriptor: string;
}

/**
 * Step A: Parse assessment-framework PDF (Pages 10-30)
 * Extract Domains and Skills hierarchy
 * Optimized for Gemini's large context window - processes entire relevant section at once
 */
async function parseAssessmentFramework(): Promise<{ domains: Map<string, { domain: Domain; skills: Skill[] }> }> {
  console.log("📄 Step A: Parsing assessment-framework-for-digital-sat-suite.pdf...");
  
  // Resolve path: script is in src/scripts/, PDFs are in data/ at project root
  const projectRoot = path.resolve(__dirname, "../..");
  const pdfPath = path.join(projectRoot, "data", "assessment-framework-for-digital-sat-suite.pdf");
  
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`PDF not found: ${pdfPath}`);
  }

  // Extract full text from PDF (Gemini can handle large context)
  console.log("📖 Extracting text from PDF...");
  const fullText = await extractTextFromPDF(pdfPath);
  
  // Extract relevant section (pages 10-30) by finding markers or using a large chunk
  // Since Gemini has a large context window, we can send more text
  // For now, we'll send the full text and let Gemini focus on the relevant section
  const relevantSection = fullText; // Gemini can handle the full document

  // Prompt for extracting domains and skills
  const extractionPrompt = `You are parsing the SAT Digital Suite Assessment Framework document.

Extract the hierarchical structure of Domains and Skills from pages 10-30 of the document.

Focus on the sections that describe:
- Reading and Writing domains (e.g., "Craft and Structure", "Information and Ideas")
- Math domains (e.g., "Heart of Algebra", "Problem Solving and Data Analysis")
- Skills within each domain (e.g., "Words in Context", "Linear Equations")

Return a JSON object with this structure:
{
  "domains": [
    {
      "name": "Domain Name (e.g., 'Craft and Structure')",
      "weight": 1.0,
      "skills": [
        {
          "name": "Skill Name (e.g., 'Words in Context')",
          "description": "Detailed description of what this skill entails",
          "bloom_level": "Apply"
        }
      ]
    }
  ]
}

Bloom levels should be one of: Remember, Understand, Apply, Analyze, Evaluate, Create

Document text:
${relevantSection}

Return ONLY valid JSON, no markdown formatting.`;
  
  console.log("🤖 Calling Gemini 2.5 Flash Lite to extract domains and skills...");
  const response = await callGemini(extractionPrompt);
  
  // Parse JSON response
  let parsed: { domains: Array<{ name: string; weight?: number; skills: Skill[] }> };
  try {
    // Remove markdown code blocks if present
    const cleaned = response.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    parsed = JSON.parse(cleaned);
  } catch (error) {
    console.error("❌ Failed to parse Gemini response as JSON:", response.substring(0, 500));
    throw error;
  }

  // Convert to Map structure
  const domainMap = new Map<string, { domain: Domain; skills: Skill[] }>();
  for (const domainData of parsed.domains) {
    domainMap.set(domainData.name, {
      domain: {
        name: domainData.name,
        weight: domainData.weight || 1.0,
      },
      skills: domainData.skills,
    });
  }

  console.log(`✅ Extracted ${domainMap.size} domains with skills`);
  return { domains: domainMap };
}

/**
 * Step B: Parse skills-insight PDF
 * Extract Score Band descriptors for each skill
 * Optimized for Gemini's large context window - processes all skills in a single request
 */
async function parseSkillsInsight(skills: Array<{ id: string; name: string; domain_name: string }>): Promise<Map<string, SkillBand[]>> {
  console.log("📄 Step B: Parsing skills-insight-digital-sat-suite.pdf...");
  
  // Resolve path: script is in src/scripts/, PDFs are in data/ at project root
  const projectRoot = path.resolve(__dirname, "../..");
  const pdfPath = path.join(projectRoot, "data", "skills-insight-digital-sat-suite.pdf");
  
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`PDF not found: ${pdfPath}`);
  }

  // Extract full text from PDF (Gemini can handle large context)
  console.log("📖 Extracting text from PDF...");
  const fullText = await extractTextFromPDF(pdfPath);

  // With Gemini's large context window, we can process ALL skills in a single request
  const skillNames = skills.map(s => s.name).join(", ");
  
  console.log(`🤖 Calling Gemini 2.5 Flash Lite to extract score bands for ${skills.length} skills...`);
  
  const extractionPrompt = `You are parsing the SAT Skills Insight document which maps skills to score band descriptors.

For each of the following skills, extract the specific ability description for each Score Band (e.g., "490-540", "550-600", "600-690", "700-800").

Skills to extract (${skills.length} total):
${skillNames}

Return a JSON object with this structure:
{
  "skill_bands": [
    {
      "skill_name": "Words in Context",
      "bands": [
        {
          "score_range": "490-540",
          "descriptor": "Students can identify the meaning of common words in context."
        },
        {
          "score_range": "550-600",
          "descriptor": "Students can determine the meaning of words in context with moderate complexity."
        },
        {
          "score_range": "600-690",
          "descriptor": "Students can make reasonable inferences in complex texts."
        },
        {
          "score_range": "700-800",
          "descriptor": "Students can analyze nuanced word choices and their impact on meaning."
        }
      ]
    }
  ]
}

Document text:
${fullText}

Return ONLY valid JSON, no markdown formatting.`;

  const response = await callGemini(extractionPrompt);

  // Parse JSON response
  const skillBandsMap = new Map<string, SkillBand[]>();
  try {
    const cleaned = response.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed: { skill_bands: Array<{ skill_name: string; bands: SkillBand[] }> } = JSON.parse(cleaned);

    for (const item of parsed.skill_bands) {
      // Validate and filter bands before storing
      const validBands = item.bands.filter(band => {
        return band && 
               band.score_range && 
               band.descriptor && 
               band.score_range.trim() !== '' && 
               band.descriptor.trim() !== '';
      });
      
      if (validBands.length > 0) {
        skillBandsMap.set(item.skill_name, validBands);
      } else {
        console.warn(`⚠️  No valid bands found for skill: ${item.skill_name}`);
      }
    }
    
    console.log(`✅ Extracted score bands for ${skillBandsMap.size} skills`);
  } catch (error) {
    console.error(`❌ Failed to parse Gemini response:`, response.substring(0, 500));
    console.error(`Error:`, error);
    throw error;
  }

  return skillBandsMap;
}

/**
 * Insert domains into database
 */
async function insertDomains(domains: Map<string, { domain: Domain; skills: Skill[] }>): Promise<Map<string, string>> {
  console.log("💾 Inserting domains into database...");
  
  const domainIdMap = new Map<string, string>(); // domain name -> domain UUID

  for (const [domainName, { domain }] of domains.entries()) {
    const result = await dbClient.query(
      `INSERT INTO domains (name, weight) 
       VALUES ($1, $2) 
       ON CONFLICT (name) DO UPDATE SET weight = EXCLUDED.weight
       RETURNING id`,
      [domain.name, domain.weight || 1.0]
    );
    
    domainIdMap.set(domainName, result.rows[0].id);
    console.log(`  ✓ Inserted domain: ${domain.name}`);
  }

  return domainIdMap;
}

/**
 * Insert skills into database
 */
async function insertSkills(
  domains: Map<string, { domain: Domain; skills: Skill[] }>,
  domainIdMap: Map<string, string>
): Promise<Map<string, { id: string; name: string; domain_name: string }>> {
  console.log("💾 Inserting skills into database...");
  
  const skillMap = new Map<string, { id: string; name: string; domain_name: string }>();

  for (const [domainName, { skills }] of domains.entries()) {
    const domainId = domainIdMap.get(domainName);
    if (!domainId) {
      console.warn(`⚠️  Domain ID not found for: ${domainName}`);
      continue;
    }

    for (const skill of skills) {
      const result = await dbClient.query(
        `INSERT INTO skills (domain_id, name, description, bloom_level) 
         VALUES ($1, $2, $3, $4) 
         ON CONFLICT (domain_id, name) DO UPDATE 
         SET description = EXCLUDED.description, bloom_level = EXCLUDED.bloom_level
         RETURNING id`,
        [domainId, skill.name, skill.description || null, skill.bloom_level || null]
      );
      
      const skillId = result.rows[0].id;
      skillMap.set(skill.name, { id: skillId, name: skill.name, domain_name: domainName });
      console.log(`  ✓ Inserted skill: ${skill.name} (${domainName})`);
    }
  }

  return skillMap;
}

/**
 * Insert skill bands into database
 */
async function insertSkillBands(
  skillMap: Map<string, { id: string; name: string; domain_name: string }>,
  skillBandsMap: Map<string, SkillBand[]>
): Promise<void> {
  console.log("💾 Inserting skill bands into database...");
  
  let totalBands = 0;
  let skippedBands = 0;

  for (const [skillName, bands] of skillBandsMap.entries()) {
    const skill = skillMap.get(skillName);
    if (!skill) {
      console.warn(`⚠️  Skill not found in database: ${skillName}`);
      continue;
    }

    // Filter out bands with null/empty descriptors
    const validBands = bands.filter(band => {
      if (!band.descriptor || band.descriptor.trim() === '') {
        console.warn(`⚠️  Skipping band with empty descriptor for skill "${skillName}", score_range: "${band.score_range}"`);
        skippedBands++;
        return false;
      }
      if (!band.score_range || band.score_range.trim() === '') {
        console.warn(`⚠️  Skipping band with empty score_range for skill "${skillName}"`);
        skippedBands++;
        return false;
      }
      return true;
    });

    for (const band of validBands) {
      try {
        await dbClient.query(
          `INSERT INTO skill_bands (skill_id, score_range, descriptor) 
           VALUES ($1, $2, $3) 
           ON CONFLICT (skill_id, score_range) DO UPDATE 
           SET descriptor = EXCLUDED.descriptor`,
          [skill.id, band.score_range, band.descriptor.trim()]
        );
        totalBands++;
      } catch (error: any) {
        console.error(`❌ Error inserting band for skill "${skillName}", score_range: "${band.score_range}"`);
        console.error(`   Descriptor: "${band.descriptor}"`);
        console.error(`   Error: ${error.message}`);
        throw error;
      }
    }
    console.log(`  ✓ Inserted ${validBands.length} bands for skill: ${skillName}`);
  }

  if (skippedBands > 0) {
    console.log(`⚠️  Skipped ${skippedBands} bands with invalid data`);
  }
  console.log(`✅ Inserted ${totalBands} total skill bands`);
}

/**
 * Validation: Query skill bands for a specific score range
 */
async function validateSeeding(): Promise<void> {
  console.log("\n🔍 Validation: Querying skill bands for score range '600-690'...");
  
  const result = await dbClient.query(
    `SELECT 
       s.name as skill_name,
       d.name as domain_name,
       sb.score_range,
       sb.descriptor
     FROM skill_bands sb
     JOIN skills s ON sb.skill_id = s.id
     JOIN domains d ON s.domain_id = d.id
     WHERE sb.score_range = $1
     LIMIT 10`,
    ["600-690"]
  );

  if (result.rows.length === 0) {
    console.warn("⚠️  No skill bands found for score range '600-690'");
  } else {
    console.log(`✅ Found ${result.rows.length} skill bands for '600-690':\n`);
    for (const row of result.rows) {
      console.log(`  [${row.domain_name}] ${row.skill_name}:`);
      console.log(`    "${row.descriptor}"\n`);
    }
  }
}

/**
 * Main execution
 */
async function main() {
  try {
    console.log("🚀 Starting Socratic Graph Taxonomy Seeder\n");

    // Connect to database
    console.log("🔌 Connecting to database...");
    await dbClient.connect();
    console.log("✅ Connected to database\n");

    // Step A: Parse assessment framework
    const { domains } = await parseAssessmentFramework();
    console.log();

    // Insert domains
    const domainIdMap = await insertDomains(domains);
    console.log();

    // Insert skills
    const skillMap = await insertSkills(domains, domainIdMap);
    console.log();

    // Step B: Parse skills insight
    const skillsArray = Array.from(skillMap.values());
    const skillBandsMap = await parseSkillsInsight(skillsArray);
    console.log();

    // Insert skill bands
    await insertSkillBands(skillMap, skillBandsMap);
    console.log();

    // Validation
    await validateSeeding();

    console.log("\n✅ Seeding complete!");
  } catch (error) {
    console.error("❌ Error during seeding:", error);
    process.exit(1);
  } finally {
    await dbClient.end();
  }
}

// Run the seeder
main();
