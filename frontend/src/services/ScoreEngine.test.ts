import { describe, test, expect } from 'vitest';
import { calculateSectionScore, scoreEngine } from './ScoreEngine';

describe('Score Engine (Linear)', () => {
  test('converts average ability (0.0) to 500', () => {
    expect(calculateSectionScore(0.0)).toBe(500);
  });

  test('converts max ability (3.0) to 800', () => {
    expect(calculateSectionScore(3.0)).toBe(800);
  });

  test('converts min ability (-3.0) to 200', () => {
    expect(calculateSectionScore(-3.0)).toBe(200);
  });

  test('clamps scores above 800', () => {
    // Theta 4.0 -> would be 900 linear, should clamp to 800
    expect(calculateSectionScore(4.0)).toBe(800);
  });

  test('rounds to nearest 10', () => {
    // Theta 0.15 -> 515 raw -> rounds to 520
    expect(calculateSectionScore(0.15)).toBe(520);
  });
});

describe('Score Engine (Table Lookup)', () => {
  test('uses default table when config is missing', () => {
    // In your DEFAULT_MATH_TABLE, theta 0.25 falls in [0.0, 0.5] -> Score 500
    const score = scoreEngine.calculateFinalScore(0.25, 'math');
    expect(score).toBe(500);
  });

  test('applies floor when theta is off the charts low', () => {
    const score = scoreEngine.calculateFinalScore(-5.0, 'math');
    expect(score).toBe(200);
  });
});
