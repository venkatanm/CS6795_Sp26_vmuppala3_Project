/**
 * Mock Exam Configuration and Packet for UI Smoke Testing
 * 
 * This file provides hardcoded mock data to test the ExamRunner UI
 * without requiring database or API connections.
 */

import { ExamConfig } from '@/src/types/ExamConfig';
import { ExamPacket } from '@/src/types/ExamPacket';

/**
 * Mock ExamConfig for smoke testing
 * Uses simulation mode with basic settings
 */
export const MOCK_EXAM_CONFIG: ExamConfig = {
  mode: 'simulation',
  timer: {
    show: true,
    direction: 'down',
    autoSubmitAtZero: true,
  },
  feedback: {
    allowImmediateCheck: false,
    showCorrectness: false,
  },
  tutor: {
    enabled: false,
  },
  routing: {
    type: 'standard',
  },
};

/**
 * Mock ExamPacket with minimal data for smoke testing
 * Contains 1 module with 1 dummy question
 */
export const MOCK_EXAM_PACKET: ExamPacket = {
  exam_id: 'mock-exam-smoke-test',
  config: {
    total_time: 3600, // 60 minutes
    allowed_tools: ['calculator'],
  },
  routing_logic: {
    module_1_threshold: 0.5,
  },
  modules: [
    {
      id: 'mock_module_1',
      type: 'fixed',
      question_order: ['mock_q_001'],
    },
  ],
  content_bank: {
    mock_q_001: {
      text: 'What is 2 + 2?',
      choices: [
        { id: 'A', text: '3' },
        { id: 'B', text: '4' },
        { id: 'C', text: '5' },
        { id: 'D', text: '6' },
      ],
      correct_answer: 'B',
      skill_tag: 'Arithmetic',
      domain: 'Math' as const,
      category: 'Algebra' as const,
      skill: 'Arithmetic',
      difficulty_level: 1,
    },
  },
};

/**
 * Mock session ID for testing
 */
export const MOCK_SESSION_ID = 'mock-session-smoke-test';
