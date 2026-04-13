import { ScoringTable, ScoringConfig } from '@/src/types/ScoringTable';

/**
 * ScoreEngine Service
 * 
 * Converts final IRT theta estimates into reported Section Scores (200-800).
 * 
 * Features:
 * - Clamps theta between -3.0 and 3.0
 * - Looks up score in scoring table
 * - Applies section floor/ceiling rules (min 200, max 800)
 * - Supports per-exam scoring curves via ExamPacket
 */
class ScoreEngineService {
  /**
   * Default scoring table for Math section
   * This is a sample table - should be replaced with actual SAT conversion tables
   */
  private readonly DEFAULT_MATH_TABLE: ScoringTable = [
    { theta_range: [-3.0, -2.5], score: 200 },
    { theta_range: [-2.5, -2.0], score: 250 },
    { theta_range: [-2.0, -1.5], score: 300 },
    { theta_range: [-1.5, -1.0], score: 350 },
    { theta_range: [-1.0, -0.5], score: 400 },
    { theta_range: [-0.5, 0.0], score: 450 },
    { theta_range: [0.0, 0.5], score: 500 },
    { theta_range: [0.5, 1.0], score: 550 },
    { theta_range: [1.0, 1.5], score: 600 },
    { theta_range: [1.5, 2.0], score: 650 },
    { theta_range: [2.0, 2.5], score: 700 },
    { theta_range: [2.5, 3.0], score: 750 },
    { theta_range: [3.0, 3.0], score: 800 }, // Handle exactly 3.0
  ];

  /**
   * Default scoring table for Reading & Writing section
   * This is a sample table - should be replaced with actual SAT conversion tables
   */
  private readonly DEFAULT_RW_TABLE: ScoringTable = [
    { theta_range: [-3.0, -2.5], score: 200 },
    { theta_range: [-2.5, -2.0], score: 250 },
    { theta_range: [-2.0, -1.5], score: 300 },
    { theta_range: [-1.5, -1.0], score: 350 },
    { theta_range: [-1.0, -0.5], score: 400 },
    { theta_range: [-0.5, 0.0], score: 450 },
    { theta_range: [0.0, 0.5], score: 500 },
    { theta_range: [0.5, 1.0], score: 550 },
    { theta_range: [1.0, 1.5], score: 600 },
    { theta_range: [1.5, 2.0], score: 650 },
    { theta_range: [2.0, 2.5], score: 700 },
    { theta_range: [2.5, 3.0], score: 750 },
    { theta_range: [3.0, 3.0], score: 800 }, // Handle exactly 3.0
  ];

  /**
   * Calculate final section score from theta estimate.
   * 
   * @param finalTheta - IRT theta estimate (typically -3.0 to 3.0)
   * @param section - Section type: 'math' or 'rw'
   * @param scoringConfig - Optional scoring configuration from ExamPacket
   * @returns Section score (200-800)
   * 
   * @example
   * ```typescript
   * const score = scoreEngine.calculateFinalScore(1.2, 'math', scoringConfig);
   * // Returns: 600 (based on scoring table)
   * ```
   */
  calculateFinalScore(
    finalTheta: number,
    section: 'math' | 'rw',
    scoringConfig?: ScoringConfig
  ): number {
    // Step 1: Clamp theta between -3.0 and 3.0
    const clampedTheta = Math.max(-3.0, Math.min(3.0, finalTheta));

    // Step 2: Get scoring table for the section
    const scoringTable = scoringConfig
      ? (section === 'math' ? scoringConfig.math : scoringConfig.rw)
      : (section === 'math' ? this.DEFAULT_MATH_TABLE : this.DEFAULT_RW_TABLE);

    // Step 3: Look up score in the table
    let sectionScore: number | null = null;

    for (const entry of scoringTable) {
      const [minTheta, maxTheta] = entry.theta_range;
      if (clampedTheta >= minTheta && clampedTheta <= maxTheta) {
        sectionScore = entry.score;
        break;
      }
    }

    // Step 4: Apply floor/ceiling rules if no match found
    if (sectionScore === null) {
      // If theta is below minimum range, use floor (200)
      if (clampedTheta < (scoringTable[0]?.theta_range[0] ?? -3.0)) {
        sectionScore = 200;
      }
      // If theta is above maximum range, use ceiling (800)
      else if (clampedTheta > (scoringTable[scoringTable.length - 1]?.theta_range[1] ?? 3.0)) {
        sectionScore = 800;
      }
      // Fallback to default or floor
      else {
        sectionScore = scoringConfig?.default_score ?? 200;
      }
    }

    // Step 5: Apply section-specific floor/ceiling rules
    // RW min is 200, Math min is 200 (both follow SAT scale)
    const finalScore = Math.max(200, Math.min(800, sectionScore));

    return finalScore;
  }

  /**
   * Convert ELO rating to IRT theta estimate.
   * 
   * This is a helper method to convert from the current ELO-based system
   * to IRT theta for scoring. The conversion is approximate.
   * 
   * @param eloRating - ELO rating (typically 800-1600, with 1200 as average)
   * @returns Approximate IRT theta estimate
   * 
   * Formula: theta ≈ (elo - 1200) / 200
   * This maps:
   * - 800 ELO → -2.0 theta
   * - 1200 ELO → 0.0 theta (average)
   * - 1600 ELO → 2.0 theta
   */
  convertEloToTheta(eloRating: number): number {
    // Normalize ELO to theta scale
    // Assuming ELO range of 800-1600 maps to theta -2.0 to 2.0
    const normalizedElo = (eloRating - 1200) / 200;
    return Math.max(-3.0, Math.min(3.0, normalizedElo));
  }

  /**
   * Calculate final score from ELO rating (convenience method).
   * 
   * @param eloRating - ELO rating (from student_theta in database)
   * @param section - Section type: 'math' or 'rw'
   * @param scoringConfig - Optional scoring configuration from ExamPacket
   * @returns Section score (200-800)
   */
  calculateFinalScoreFromElo(
    eloRating: number,
    section: 'math' | 'rw',
    scoringConfig?: ScoringConfig
  ): number {
    const theta = this.convertEloToTheta(eloRating);
    return this.calculateFinalScore(theta, section, scoringConfig);
  }

  /**
   * Validate scoring table structure.
   * 
   * @param scoringTable - Scoring table to validate
   * @returns true if valid, throws error if invalid
   */
  validateScoringTable(scoringTable: ScoringTable): boolean {
    if (!Array.isArray(scoringTable) || scoringTable.length === 0) {
      throw new Error('Scoring table must be a non-empty array');
    }

    for (let i = 0; i < scoringTable.length; i++) {
      const entry = scoringTable[i];
      
      if (!entry.theta_range || !Array.isArray(entry.theta_range) || entry.theta_range.length !== 2) {
        throw new Error(`Entry ${i}: theta_range must be a tuple [min, max]`);
      }

      const [minTheta, maxTheta] = entry.theta_range;
      
      if (typeof minTheta !== 'number' || typeof maxTheta !== 'number') {
        throw new Error(`Entry ${i}: theta_range values must be numbers`);
      }

      if (minTheta > maxTheta) {
        throw new Error(`Entry ${i}: minTheta (${minTheta}) must be <= maxTheta (${maxTheta})`);
      }

      if (typeof entry.score !== 'number' || entry.score < 200 || entry.score > 800) {
        throw new Error(`Entry ${i}: score must be a number between 200 and 800`);
      }

      // Check for gaps or overlaps (warn but don't fail)
      if (i > 0) {
        const prevMax = scoringTable[i - 1].theta_range[1];
        if (minTheta > prevMax) {
          console.warn(`Entry ${i}: Gap detected between ${prevMax} and ${minTheta}`);
        }
        if (minTheta < prevMax) {
          console.warn(`Entry ${i}: Overlap detected between ${prevMax} and ${minTheta}`);
        }
      }
    }

    return true;
  }

  /**
   * Calculate section score from theta using linear conversion.
   * 
   * Converts IRT theta (-3.0 to +3.0) to SAT section score (200-800).
   * Formula: score = 500 + (theta * 100), clamped to [200, 800], rounded to nearest 10.
   * 
   * @param theta - IRT theta estimate (-3.0 to 3.0)
   * @returns Section score (200-800), rounded to nearest 10
   */
  calculateSectionScore(theta: number): number {
    // Clamp theta to [-3.0, 3.0]
    const clampedTheta = Math.max(-3.0, Math.min(3.0, theta));
    
    // Linear conversion: 500 (average) + (theta * 100)
    // This maps:
    // - theta = -3.0 → 500 + (-3.0 * 100) = 200
    // - theta = 0.0 → 500 + (0.0 * 100) = 500
    // - theta = 3.0 → 500 + (3.0 * 100) = 800
    const rawScore = 500 + (clampedTheta * 100);
    
    // Clamp to [200, 800]
    const clampedScore = Math.max(200, Math.min(800, rawScore));
    
    // Round to nearest 10
    return Math.round(clampedScore / 10) * 10;
  }
}

// Export singleton instance
export const scoreEngine = new ScoreEngineService();

// Export for testing or custom instances
export default ScoreEngineService;

/**
 * Calculate section score from theta (convenience function).
 * 
 * @param theta - IRT theta estimate (-3.0 to 3.0)
 * @returns Section score (200-800), rounded to nearest 10
 */
export function calculateSectionScore(theta: number): number {
  return scoreEngine.calculateSectionScore(theta);
}
