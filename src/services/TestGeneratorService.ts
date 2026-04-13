/**
 * Test Generator Service
 * 
 * Generates personalized "Daily Test" packets using:
 * - Spaced repetition review queue (60% - Bucket A)
 * - Misconception traps (20% - Bucket B)
 * - Maintenance review (20% - Bucket C)
 */

import { Client } from 'pg';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { getConceptsForReview, StudentProfile } from './CurriculumService';
import { ExamPacket, QuestionContent, ExamModule } from '../../frontend/src/types/ExamPacket';

// Get project root (assuming this file is in src/services/)
const projectRoot = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(projectRoot, ".env") });

// Database connection
let dbClient: Client | null = null;

function getDbClient(): Client {
  if (!dbClient) {
    dbClient = new Client({
      host: process.env.DB_HOST || "localhost",
      port: parseInt(process.env.DB_PORT || "5432"),
      database: process.env.DB_NAME || "fastapi_db",
      user: process.env.DB_USER || "postgres",
      password: process.env.DB_PASSWORD || "postgres",
    });
  }
  return dbClient;
}

/**
 * Get student profile from database
 */
async function getStudentProfile(userId: string, tenantId: string = "public"): Promise<StudentProfile | null> {
  const db = getDbClient();
  
  try {
    await db.connect();
  } catch (error: any) {
    // Already connected, ignore error
    if (error.code !== '57P03') {
      throw error;
    }
  }

  try {
    const result = await db.query(
      `SELECT concept_mastery, unlocked_concepts, locked_concepts, 
              review_queue, next_session_focus, total_sessions, last_session_at
       FROM student_profiles
       WHERE user_id = $1 AND tenant_id = $2`,
      [userId, tenantId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      userId,
      tenantId,
      conceptMastery: row.concept_mastery || {},
      unlockedConcepts: row.unlocked_concepts || [],
      lockedConcepts: row.locked_concepts || [],
      reviewQueue: row.review_queue || [],
      nextSessionFocus: row.next_session_focus || undefined,
      totalSessions: row.total_sessions || 0,
      lastSessionAt: row.last_session_at ? new Date(row.last_session_at).toISOString() : undefined,
    };
  } catch (error) {
    console.error(`[TestGeneratorService] Error fetching student profile: ${error}`);
    throw error;
  }
}

/**
 * Get items (questions) for a concept
 */
async function getItemsForConcept(
  conceptId: string,
  difficulty: 'Hard' | 'Medium' | null = null,
  limit: number = 10,
  tenantId: string = "public"
): Promise<Array<{
  id: string;
  question_text: string;
  correct_answer: string;
  options: any[];
  solution_text?: string;
  skill_tag?: string;
  variables?: any;
}>> {
  const db = getDbClient();
  
  try {
    await db.connect();
  } catch (error: any) {
    // Already connected, ignore error
    if (error.code !== '57P03') {
      throw error;
    }
  }

  try {
    let query = `
      SELECT DISTINCT i.id, i.question_text, i.correct_answer, i.options, 
             i.solution_text, i.skill_tag, i.variables
      FROM items i
      INNER JOIN question_concepts qc ON i.id = qc.question_id
      WHERE qc.concept_id = $1::uuid
        AND i.tenant_id = $2
    `;

    const params: any[] = [conceptId, tenantId];

    // Add difficulty filter if specified
    if (difficulty) {
      // Map full words to single-letter codes (database stores E/M/H)
      const difficultyMap: Record<string, string> = {
        'Easy': 'E',
        'Medium': 'M',
        'Hard': 'H',
        'E': 'E',
        'M': 'M',
        'H': 'H'
      };
      const mappedDifficulty = difficultyMap[difficulty] || difficulty;
      
      // Check both formats (E/M/H and Easy/Medium/Hard)
      query += ` AND (
        (i.variables->>'difficulty' = $3) OR
        (i.variables->>'difficulty' = $4) OR
        (i.variables->>'difficulty_level' = $3) OR
        (i.variables->>'difficulty_level' = $4)
      )`;
      params.push(difficulty, mappedDifficulty);
    }

    query += ` LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await db.query(query, params);
    return result.rows.map(row => ({
      id: row.id,
      question_text: row.question_text,
      correct_answer: row.correct_answer,
      options: row.options || [],
      solution_text: row.solution_text,
      skill_tag: row.skill_tag,
      variables: row.variables || {},
    }));
  } catch (error) {
    console.error(`[TestGeneratorService] Error fetching items for concept ${conceptId}: ${error}`);
    return [];
  }
}

/**
 * Get last 5 misconceptions triggered by user
 * 
 * This queries tutor_chats and sessions to find misconceptions that were diagnosed.
 * Falls back to common misconceptions if no user-specific data is found.
 */
async function getRecentMisconceptions(
  userId: string,
  tenantId: string = "public",
  limit: number = 5
): Promise<Array<{ misconception_id: string; misconception_name: string }>> {
  const db = getDbClient();
  
  try {
    await db.connect();
  } catch (error: any) {
    // Already connected, ignore error
    if (error.code !== '57P03') {
      throw error;
    }
  }

  try {
    // Strategy 1: Query tutor_chats for this user where incorrect answers were given
    // and try to match with misconceptions via the question's skill
    const tutorChatResult = await db.query(
      `SELECT DISTINCT tc.question_id, tc.category
       FROM tutor_chats tc
       INNER JOIN sessions s ON tc.session_id = s.id
       WHERE s.user_id = $1 AND s.tenant_id = $2
         AND tc.student_answer != tc.correct_answer
         AND tc.category IS NOT NULL
       ORDER BY tc.created_at DESC
       LIMIT $3`,
      [userId, tenantId, limit * 2]
    );

    if (tutorChatResult.rows.length > 0) {
      // Try to find misconceptions related to these categories
      const categories = [...new Set(tutorChatResult.rows.map(r => r.category).filter(Boolean))];
      
      if (categories.length > 0) {
        const categoryPatterns = categories.map(c => `%${c}%`);
        const misconceptionResult = await db.query(
          `SELECT DISTINCT m.id, m.name
           FROM misconceptions m
           INNER JOIN skill_misconceptions sm ON m.id = sm.misconception_id
           INNER JOIN skills s ON sm.skill_id = s.id
           WHERE s.name ILIKE ANY($1::text[])
              OR s.category ILIKE ANY($1::text[])
           ORDER BY m.created_at DESC
           LIMIT $2`,
          [categoryPatterns, limit]
        );

        if (misconceptionResult.rows.length > 0) {
          return misconceptionResult.rows.map(row => ({
            misconception_id: row.id,
            misconception_name: row.name,
          }));
        }
      }
    }

    // Strategy 2: Fallback to most common misconceptions (those with most items)
    const fallbackResult = await db.query(
      `SELECT DISTINCT m.id, m.name
       FROM misconceptions m
       INNER JOIN skill_misconceptions sm ON m.id = sm.misconception_id
       INNER JOIN skills s ON sm.skill_id = s.id
       INNER JOIN items i ON i.skill_id = s.id
       GROUP BY m.id, m.name
       ORDER BY COUNT(i.id) DESC
       LIMIT $1`,
      [limit]
    );

    return fallbackResult.rows.map(row => ({
      misconception_id: row.id,
      misconception_name: row.name,
    }));
  } catch (error) {
    console.error(`[TestGeneratorService] Error fetching recent misconceptions: ${error}`);
    // Return empty array on error
    return [];
  }
}

/**
 * Get items that test specific misconceptions
 */
async function getItemsForMisconceptions(
  misconceptionIds: string[],
  limit: number = 2,
  tenantId: string = "public"
): Promise<Array<{
  id: string;
  question_text: string;
  correct_answer: string;
  options: any[];
  solution_text?: string;
  skill_tag?: string;
  variables?: any;
}>> {
  if (misconceptionIds.length === 0) {
    return [];
  }

  const db = getDbClient();
  
  try {
    await db.connect();
  } catch (error: any) {
    // Already connected, ignore error
    if (error.code !== '57P03') {
      throw error;
    }
  }

  try {
    // Query items via skill_misconceptions -> skills -> items (via skill_id)
    // Or via question_concepts -> concepts -> concept_misconceptions -> misconceptions
    const result = await db.query(
      `SELECT DISTINCT i.id, i.question_text, i.correct_answer, i.options, 
              i.solution_text, i.skill_tag, i.variables
       FROM items i
       INNER JOIN skills s ON i.skill_id = s.id
       INNER JOIN skill_misconceptions sm ON s.id = sm.skill_id
       WHERE sm.misconception_id = ANY($1::uuid[])
         AND i.tenant_id = $2
       LIMIT $3`,
      [misconceptionIds, tenantId, limit]
    );

    return result.rows.map(row => ({
      id: row.id,
      question_text: row.question_text,
      correct_answer: row.correct_answer,
      options: row.options || [],
      solution_text: row.solution_text,
      skill_tag: row.skill_tag,
      variables: row.variables || {},
    }));
  } catch (error) {
    console.error(`[TestGeneratorService] Error fetching items for misconceptions: ${error}`);
    // Fallback: return random items if misconception query fails
    return getRandomItems(limit, tenantId);
  }
}

/**
 * Get random items as fallback
 */
async function getRandomItems(
  limit: number = 10,
  tenantId: string = "public"
): Promise<Array<{
  id: string;
  question_text: string;
  correct_answer: string;
  options: any[];
  solution_text?: string;
  skill_tag?: string;
  variables?: any;
}>> {
  const db = getDbClient();
  
  try {
    await db.connect();
  } catch (error: any) {
    // Already connected, ignore error
    if (error.code !== '57P03') {
      throw error;
    }
  }

  try {
    const result = await db.query(
      `SELECT id, question_text, correct_answer, options, 
              solution_text, skill_tag, variables
       FROM items
       WHERE tenant_id = $1
       ORDER BY RANDOM()
       LIMIT $2`,
      [tenantId, limit]
    );

    return result.rows.map(row => ({
      id: row.id,
      question_text: row.question_text,
      correct_answer: row.correct_answer,
      options: row.options || [],
      solution_text: row.solution_text,
      skill_tag: row.skill_tag,
      variables: row.variables || {},
    }));
  } catch (error) {
    console.error(`[TestGeneratorService] Error fetching random items: ${error}`);
    return [];
  }
}

/**
 * Convert database item to QuestionContent format
 */
function itemToQuestionContent(item: {
  id: string;
  question_text: string;
  correct_answer: string;
  options: any[];
  solution_text?: string;
  skill_tag?: string;
  variables?: any;
}): QuestionContent {
  // Parse options array
  const choices = Array.isArray(item.options)
    ? item.options.map((opt, idx) => ({
        id: String.fromCharCode(65 + idx), // A, B, C, D...
        text: typeof opt === 'string' ? opt : opt.text || String(opt),
      }))
    : [];

  // Determine correct answer
  let correctAnswer: string | number;
  if (typeof item.correct_answer === 'string') {
    // Try to find matching choice ID
    const correctIdx = item.options.findIndex(
      opt => String(opt) === item.correct_answer || (opt as any)?.text === item.correct_answer
    );
    correctAnswer = correctIdx >= 0 ? String.fromCharCode(65 + correctIdx) : item.correct_answer;
  } else {
    correctAnswer = item.correct_answer;
  }

  // Extract domain from variables or skill_tag
  const domain = item.variables?.domain || 
                 (item.skill_tag?.toLowerCase().includes('math') ? 'Math' : 'Reading and Writing');
  
  // Determine if this is a Student-Produced Response (SPR) question
  const questionType = item.variables?.question_type || '';
  const isSpr = (
    item.variables?.is_spr ||
    item.variables?.type === 'spr' ||
    questionType === 'SPR Math' ||
    questionType === 'SPR RW' ||
    (choices.length === 0 && item.variables?.section === 'Math')
  );

  return {
    text: item.question_text,
    choices,
    correct_answer: correctAnswer,
    solution_text: item.solution_text,
    skill_tag: item.skill_tag,
    domain: domain as 'Reading and Writing' | 'Math',
    category: item.variables?.primary_class || item.variables?.category || 'General',
    skill: item.skill_tag || 'General',
    difficulty_level: item.variables?.difficulty_level || item.variables?.difficulty || 2,
    is_spr: isSpr,  // Student-Produced Response flag
  };
}

/**
 * Generate a 10-question Daily Test packet
 * 
 * Composition:
 * - Bucket A (6 questions): Top 3 struggling concepts, 2 questions each
 * - Bucket B (2 questions): Misconception traps
 * - Bucket C (2 questions): Maintenance review (lower priority)
 */
export async function generateDailyTest(
  userId: string,
  tenantId: string = "public"
): Promise<ExamPacket> {
  const db = getDbClient();
  
  try {
    await db.connect();
  } catch (error: any) {
    // Already connected, ignore error
    if (error.code !== '57P03') {
      throw error;
    }
  }

  try {
    // 1. Fetch student profile
    const profile = await getStudentProfile(userId, tenantId);
    
    if (!profile) {
      // New user: return random mix
      console.log(`[TestGeneratorService] No profile found for user ${userId}, generating random test`);
      const randomItems = await getRandomItems(10, tenantId);
      return buildExamPacket(randomItems, userId);
    }

    // 2. Get concepts for review (sorted by priority)
    const reviewConcepts = getConceptsForReview(profile);

    const selectedItems: Array<{
      id: string;
      question_text: string;
      correct_answer: string;
      options: any[];
      solution_text?: string;
      skill_tag?: string;
      variables?: any;
    }> = [];

    // 3. Bucket A: Top 3 concepts, 2 questions each (6 questions)
    if (reviewConcepts.length > 0) {
      const top3Concepts = reviewConcepts.slice(0, 3);
      
      for (const reviewConcept of top3Concepts) {
        // Get 2 Hard/Medium questions for this concept
        const items = await getItemsForConcept(reviewConcept.conceptId, 'Hard', 2, tenantId);
        if (items.length === 0) {
          // Fallback to Medium if no Hard questions
          const mediumItems = await getItemsForConcept(reviewConcept.conceptId, 'Medium', 2, tenantId);
          selectedItems.push(...mediumItems);
        } else {
          selectedItems.push(...items);
        }
      }
    }

    // 4. Bucket B: Misconception traps (2 questions)
    const recentMisconceptions = await getRecentMisconceptions(userId, tenantId, 5);
    if (recentMisconceptions.length > 0) {
      const misconceptionIds = recentMisconceptions.map(m => m.misconception_id);
      const trapItems = await getItemsForMisconceptions(misconceptionIds, 2, tenantId);
      selectedItems.push(...trapItems);
    }

    // 5. Bucket C: Maintenance review (2 questions, priority < 0.3)
    const maintenanceConcepts = reviewConcepts.filter(c => c.priority < 0.3);
    if (maintenanceConcepts.length > 0) {
      // Select 2 Hard questions from maintenance concepts
      for (const concept of maintenanceConcepts.slice(0, 2)) {
        const items = await getItemsForConcept(concept.conceptId, 'Hard', 1, tenantId);
        if (items.length > 0) {
          selectedItems.push(...items);
        }
      }
    }

    // 6. Fallback: If we don't have 10 questions, fill with random items
    if (selectedItems.length < 10) {
      const needed = 10 - selectedItems.length;
      const existingIds = new Set(selectedItems.map(i => i.id));
      const randomItems = await getRandomItems(needed * 2, tenantId);
      const uniqueRandomItems = randomItems.filter(item => !existingIds.has(item.id));
      selectedItems.push(...uniqueRandomItems.slice(0, needed));
    }

    // 7. Build and return ExamPacket
    return buildExamPacket(selectedItems.slice(0, 10), userId);
  } catch (error) {
    console.error(`[TestGeneratorService] Error generating daily test: ${error}`);
    // Fallback to random items on error
    const randomItems = await getRandomItems(10, tenantId);
    return buildExamPacket(randomItems, userId);
  }
}

/**
 * Build ExamPacket from selected items
 */
function buildExamPacket(
  items: Array<{
    id: string;
    question_text: string;
    correct_answer: string;
    options: any[];
    solution_text?: string;
    skill_tag?: string;
    variables?: any;
  }>,
  userId: string
): ExamPacket {
  // Convert items to QuestionContent format
  const contentBank: Record<string, QuestionContent> = {};
  const questionOrder: string[] = [];

  items.forEach(item => {
    const questionId = `daily-${item.id}`;
    contentBank[questionId] = itemToQuestionContent(item);
    questionOrder.push(questionId);
  });

  // Create a single module for the daily test
  const module: ExamModule = {
    id: 'daily_module',
    type: 'fixed',
    question_order: questionOrder,
  };

  return {
    exam_id: `daily-test-${userId}-${Date.now()}`,
    config: {
      total_time: 600, // 10 minutes for 10 questions
      allowed_tools: ['calculator'],
    },
    routing_logic: {
      module_1_threshold: 0, // Not applicable for daily tests
    },
    modules: [module],
    content_bank: contentBank,
  };
}
