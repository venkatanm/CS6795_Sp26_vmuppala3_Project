import { describe, test, expect } from 'vitest';
import {
  probability3PL,
  estimateThetaMLE,
  logLikelihood,
  itemInformation,
  testInformation,
  type ResponsePattern,
} from './irt';

describe('3PL Probability Function', () => {
  test('should return probability close to c when theta is very low', () => {
    // Change theta from -3.0 to -6.0 to force the asymptote
    const prob = probability3PL(-6.0, 1.0, 0.0, 0.25);
    expect(prob).toBeCloseTo(0.25, 2);
  });

  test('should return probability close to 1.0 when theta is very high', () => {
    const prob = probability3PL(3.0, 1.0, 0.0, 0.25);
    expect(prob).toBeGreaterThan(0.95);
  });

  test('should return probability of 0.5 when theta equals difficulty (b)', () => {
    // Note: When c=0, P=0.5. When c>0, P = c + (1-c)/2
    const prob = probability3PL(1.5, 1.0, 1.5, 0.0);
    expect(prob).toBeCloseTo(0.5, 2);
  });

  test('should throw error for invalid parameters', () => {
    expect(() => probability3PL(0.0, -1.0, 0.0, 0.0)).toThrow(/positive/);
    expect(() => probability3PL(0.0, 1.0, 0.0, 1.5)).toThrow(/Pseudo-guessing/);
  });
});

describe('Maximum Likelihood Estimation (MLE)', () => {
  test('should estimate high theta for student who answers hard questions correctly', () => {
    const patterns: ResponsePattern[] = Array(5).fill({ a: 1.0, b: 1.5, c: 0.25, response: 1 });
    const theta = estimateThetaMLE(patterns);
    expect(theta).toBeGreaterThan(1.0);
  });

  test('should estimate low theta for student who answers easy questions incorrectly', () => {
    const patterns: ResponsePattern[] = Array(5).fill({ a: 1.0, b: -1.5, c: 0.25, response: 0 });
    const theta = estimateThetaMLE(patterns);
    expect(theta).toBeLessThan(-1.0);
  });

  test('should estimate theta around 0 for mixed performance', () => {
    const patterns: ResponsePattern[] = [
      { a: 1.0, b: -1.0, c: 0.25, response: 1 },
      { a: 1.0, b: -1.0, c: 0.25, response: 1 },
      { a: 1.0, b: 0.0, c: 0.25, response: 1 },
      { a: 1.0, b: 1.0, c: 0.25, response: 0 },
      { a: 1.0, b: 1.0, c: 0.25, response: 0 },
    ];
    const theta = estimateThetaMLE(patterns);
    expect(theta).toBeGreaterThan(-0.5);
    expect(theta).toBeLessThan(0.5);
  });

  test('should handle empty patterns array', () => {
    expect(() => estimateThetaMLE([])).toThrow();
  });
});

describe('Information Functions', () => {
  test('item information peaks near difficulty', () => {
    const infoAtDiff = itemInformation(0.0, 1.0, 0.0, 0.25);
    const infoFar = itemInformation(2.0, 1.0, 0.0, 0.25);
    expect(infoAtDiff).toBeGreaterThan(infoFar);
  });
});
