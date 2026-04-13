const fs = require('fs');
const path = require('path');

// --- CONFIGURATION ---
// Adjust these paths relative to where you run the script (frontend folder)
// If 'questions' is in project root, we go up one level (../questions)
const INPUT_DIR = path.join(__dirname, '../../questions'); 
const OUTPUT_FILE = path.join(__dirname, '../public/sat-full.json');

/**
 * Maps a raw question object to the standardized question format
 * @param {Object} raw - Raw question data from source
 * @param {number} index - Index of the question in the array
 * @returns {Object} Mapped question object
 */
function mapQuestion(raw, index) {
  // 1. Handle Image Path
  let finalImage = null;
  // Check if the JSON has an image filename (e.g., "fig1.png")
  const rawImage = raw.image || raw.figure || raw.attachment; 
  
  if (rawImage) {
    // We prepend the public folder path so the browser can find it
    // Example result: "/extracted_images/fig1.png"
    // Remove any existing path garbage if strictly filenames are provided
    const filename = path.basename(rawImage); 
    finalImage = `/extracted_images/${filename}`;
  }

  // 2. Handle Question Text (multiple possible field names)
  // Math questions use "prompt", English questions use "stem"
  const stem = raw.stem || raw.question || raw.prompt || raw.text || "Question Text Missing";
  
  // 2b. Handle Passage Text (for reading comprehension questions)
  // English questions have "stimulus", some have "passageText"
  const passageText = raw.passageText || raw.passage || raw.stimulus || "";

  // 3. Handle Choices (multiple formats for Math vs English)
  let choices = [];
  
  // Format 1: Flat choices array (standard - already normalized)
  if (raw.choices && Array.isArray(raw.choices) && raw.choices.length > 0) {
    choices = raw.choices.map(c => {
      // If already normalized format { id, text }, use as-is
      if (c && typeof c === 'object' && (c.id || c.letter) && (c.text || c.content)) {
        return {
          id: String(c.id || c.letter).toUpperCase(),
          text: c.text || c.content || String(c)
        };
      }
      // Otherwise, it's a string or needs normalization
      return {
        id: String(c.id || c.letter || String.fromCharCode(65 + raw.choices.indexOf(c))).toUpperCase(),
        text: c.text || c.content || String(c)
      };
    });
  }
  // Format 2: answerOptions array (English questions - e.g., q_b4d29611.json)
  else if (raw.answerOptions && Array.isArray(raw.answerOptions) && raw.answerOptions.length > 0) {
    choices = raw.answerOptions.map((opt, idx) => {
      // answerOptions have UUIDs as IDs, so we use index to generate A, B, C, D
      return {
        id: String.fromCharCode(65 + idx), // A, B, C, D based on position
        text: opt.content || opt.text || String(opt)
      };
    });
  }
  // Format 3: Nested answer.choices structure (Math questions - e.g., q_1dcea480.json)
  else if (raw.answer && raw.answer.choices) {
    const nestedChoices = raw.answer.choices;
    // Check if it's an object (not array)
    if (typeof nestedChoices === 'object' && !Array.isArray(nestedChoices)) {
      // Sort keys to ensure consistent order (a, b, c, d)
      const sortedKeys = Object.keys(nestedChoices).sort();
      choices = sortedKeys.map(key => ({
        id: key.toUpperCase(),
        text: nestedChoices[key].body || nestedChoices[key].text || nestedChoices[key].content || String(nestedChoices[key])
      }));
    }
  }
  // Format 4: options array (fallback)
  else if (raw.options && Array.isArray(raw.options) && raw.options.length > 0) {
    choices = raw.options.map((c, idx) => ({
      id: String(c.id || c.letter || String.fromCharCode(65 + idx)).toUpperCase(),
      text: c.text || c.content || String(c)
    }));
  }
  
  // Log warning if no choices found (only for first few to avoid spam)
  if (choices.length === 0) {
    const questionId = raw.id || raw.questionId || `q_${index}`;
    console.warn(`⚠️ No choices found for ${questionId}. Checked: choices, answerOptions, answer.choices, options`);
  }
  
  // 4. Handle Correct Answer (can be string, array, or nested)
  let correctAnswer = null;
  if (raw.correct_answer) {
    // Handle array format: ["B"] -> "B"
    if (Array.isArray(raw.correct_answer)) {
      correctAnswer = raw.correct_answer[0];
    } else {
      correctAnswer = raw.correct_answer;
    }
  } else if (raw.answerKey) {
    correctAnswer = raw.answerKey;
  } else if (raw.answer?.key) {
    correctAnswer = raw.answer.key;
  }
  
  // If answer is in rationale, try to extract it (e.g., "Choice C is correct")
  if (!correctAnswer && raw.answer?.rationale) {
    const match = raw.answer.rationale.match(/Choice ([A-D]) is correct/i);
    if (match) {
      correctAnswer = match[1];
    }
  }
  
  // Convert to string if needed
  if (correctAnswer !== null) {
    correctAnswer = String(correctAnswer);
  }

  return {
    id: raw.id || raw.questionId || `q_${index}`,
    domain: raw.domain || raw.section || 'General',
    stem: stem,
    passageText: passageText,
    imageUrl: finalImage, // <--- The Web-Ready Path
    choices: choices,
    correctAnswer: correctAnswer,
    difficulty: raw.difficulty || 'medium'
  };
}

console.log(`🚀 Reading JSONs from: ${INPUT_DIR}`);

// Check if input directory exists
if (!fs.existsSync(INPUT_DIR)) {
  console.error(`❌ Error: Input directory not found: ${INPUT_DIR}`);
  process.exit(1);
}

// Read all JSON files from the questions directory
const jsonFiles = fs.readdirSync(INPUT_DIR)
  .filter(file => file.endsWith('.json'))
  .map(file => path.join(INPUT_DIR, file));

console.log(`📁 Found ${jsonFiles.length} JSON files`);

// Process each JSON file and collect questions
const allQuestions = [];
let processedCount = 0;
let errorCount = 0;

for (const filePath of jsonFiles) {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const rawData = JSON.parse(fileContent);
    
    // Handle both single question objects and arrays of questions
    const questions = Array.isArray(rawData) ? rawData : [rawData];
    
    questions.forEach((raw, index) => {
      const mapped = mapQuestion(raw, index);
      allQuestions.push(mapped);
    });
    
    processedCount++;
  } catch (error) {
    console.error(`⚠️  Error processing ${path.basename(filePath)}:`, error.message);
    errorCount++;
  }
}

console.log(`✅ Processed ${processedCount} files successfully`);
if (errorCount > 0) {
  console.log(`⚠️  ${errorCount} files had errors`);
}

console.log(`📊 Total questions mapped: ${allQuestions.length}`);

// Create output directory if it doesn't exist
const outputDir = path.dirname(OUTPUT_FILE);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Build content_bank (object with question IDs as keys)
const contentBank = {};
let questionsWithoutChoices = 0;
allQuestions.forEach(q => {
  const choices = q.choices || [];
  if (choices.length === 0) {
    questionsWithoutChoices++;
    if (questionsWithoutChoices <= 5) {
      console.warn(`⚠️ Question ${q.id} has no choices after mapping`);
    }
  }
  
  contentBank[q.id] = {
    id: q.id,
    text: q.stem,
    passageText: q.passageText || q.stimulus || q.passage || "",
    choices: choices, // Store normalized choices array
    correct_answer: q.correctAnswer,
    imageUrl: q.imageUrl || null,
    domain: q.domain,
    difficulty: q.difficulty
  };
});

if (questionsWithoutChoices > 0) {
  console.warn(`⚠️ Total questions without choices: ${questionsWithoutChoices} out of ${allQuestions.length}`);
}

// --- CATEGORIZE QUESTIONS BY DIFFICULTY ---
// Normalize difficulty values (handle case-insensitive and variations)
function normalizeDifficulty(diff) {
  if (!diff) return 'medium';
  const normalized = String(diff).toLowerCase().trim();
  if (normalized.includes('hard') || normalized === 'h' || normalized === 'high') return 'hard';
  if (normalized.includes('easy') || normalized === 'e' || normalized === 'low') return 'easy';
  return 'medium'; // Default to medium
}

// Categorize questions
const hardQuestions = [];
const easyQuestions = [];
const mediumQuestions = [];

allQuestions.forEach(q => {
  const difficulty = normalizeDifficulty(q.difficulty);
  if (difficulty === 'hard') {
    hardQuestions.push(q);
  } else if (difficulty === 'easy') {
    easyQuestions.push(q);
  } else {
    mediumQuestions.push(q);
  }
});

console.log(`\n📊 Difficulty Breakdown:`);
console.log(`   - Hard questions: ${hardQuestions.length}`);
console.log(`   - Easy questions: ${easyQuestions.length}`);
console.log(`   - Medium questions: ${mediumQuestions.length}`);

// --- CREATE MODULES BASED ON DIFFICULTY ---
// Module 1: Use medium questions (or mix if not enough medium)
// If not enough medium, mix medium + some easy + some hard
const module1Questions = [];
if (mediumQuestions.length >= 27) {
  // Use first 27 medium questions for Module 1
  module1Questions.push(...mediumQuestions.slice(0, 27));
  console.log(`   ✅ Module 1: Using 27 medium questions`);
} else {
  // Mix: all medium + some easy + some hard to reach 27
  module1Questions.push(...mediumQuestions);
  const needed = 27 - mediumQuestions.length;
  if (easyQuestions.length > 0) {
    module1Questions.push(...easyQuestions.slice(0, Math.ceil(needed / 2)));
  }
  if (hardQuestions.length > 0) {
    module1Questions.push(...hardQuestions.slice(0, Math.floor(needed / 2)));
  }
  console.log(`   ⚠️  Module 1: Mixed ${module1Questions.length} questions (${mediumQuestions.length} medium, ${easyQuestions.length} easy available, ${hardQuestions.length} hard available)`);
}

// Module 2 Hard: Use hard questions (exclude any already used in Module 1)
// Get IDs already used in Module 1
const module1QuestionIds = new Set(module1Questions.map(q => q.id));
// Filter out questions already in Module 1, then take up to 27
const availableHardQuestions = hardQuestions.filter(q => !module1QuestionIds.has(q.id));
const module2HardQuestions = availableHardQuestions.slice(0, 27);
if (module2HardQuestions.length < 27) {
  console.log(`   ⚠️  Module 2 Hard: Only ${module2HardQuestions.length} hard questions available (target: 27)`);
  if (module1QuestionIds.size > 0) {
    console.log(`      (Excluded ${hardQuestions.length - availableHardQuestions.length} hard questions already used in Module 1)`);
  }
} else {
  console.log(`   ✅ Module 2 Hard: Using 27 hard questions`);
}

// Module 2 Easy: Use easy questions (exclude any already used in Module 1)
// Filter out questions already in Module 1, then take up to 27
const availableEasyQuestions = easyQuestions.filter(q => !module1QuestionIds.has(q.id));
const module2EasyQuestions = availableEasyQuestions.slice(0, 27);
if (module2EasyQuestions.length < 27) {
  console.log(`   ⚠️  Module 2 Easy: Only ${module2EasyQuestions.length} easy questions available (target: 27)`);
  if (module1QuestionIds.size > 0) {
    console.log(`      (Excluded ${easyQuestions.length - availableEasyQuestions.length} easy questions already used in Module 1)`);
  }
} else {
  console.log(`   ✅ Module 2 Easy: Using 27 easy questions`);
}

// Create modules array
const modules = [
  {
    id: 'rw_module_1',
    type: 'fixed',
    question_order: module1Questions.map(q => q.id)
  },
  {
    id: 'rw_module_2_hard',
    type: 'fixed',
    question_order: module2HardQuestions.map(q => q.id)
  },
  {
    id: 'rw_module_2_easy',
    type: 'fixed',
    question_order: module2EasyQuestions.map(q => q.id)
  }
];

// Create ExamPacket structure (matches ExamPacket interface)
const examPacket = {
  exam_id: 'sat-full',
  config: {
    total_time: 3600, // 60 minutes for full test (adjust as needed)
    allowed_tools: ['calculator', 'highlighter']
  },
  routing_logic: {
    module_1_threshold: 12 // Threshold for adaptive routing
  },
  modules: modules,
  content_bank: contentBank
};

// Write the bundled output
fs.writeFileSync(OUTPUT_FILE, JSON.stringify(examPacket, null, 2), 'utf8');

console.log(`💾 Output written to: ${OUTPUT_FILE}`);
console.log(`✨ Bundle complete!`);
console.log(`\n📈 Final Statistics:`);
console.log(`   - Total questions: ${allQuestions.length}`);
console.log(`   - Content bank size: ${Object.keys(contentBank).length}`);
console.log(`   - Modules created: ${modules.length}`);
console.log(`   - Module 1 (${modules[0].id}): ${modules[0].question_order.length} questions`);
console.log(`   - Module 2 Hard (${modules[1].id}): ${modules[1].question_order.length} questions`);
console.log(`   - Module 2 Easy (${modules[2].id}): ${modules[2].question_order.length} questions`);
