/**
 * Item Response Theory (IRT) - 3PL Model
 * 
 * Implements the 3-Parameter Logistic (3PL) IRT model for psychometric analysis.
 * 
 * The 3PL model estimates the probability of a correct response based on:
 * - Student ability (theta)
 * - Item discrimination (a)
 * - Item difficulty (b)
 * - Pseudo-guessing parameter (c)
 */

/**
 * Calculate the probability of a correct response using the 3PL model.
 * 
 * Formula: P(θ) = c + (1-c) / (1 + e^(-a(θ - b)))
 * 
 * @param theta - Student ability parameter (-3.0 to +3.0)
 * @param a - Discrimination parameter (typically 0.5 to 2.5)
 * @param b - Difficulty parameter (typically -3.0 to +3.0)
 * @param c - Pseudo-guessing parameter (typically 0.0 to 0.25)
 * @returns Probability of correct response (0.0 to 1.0)
 */
export function probability3PL(
  theta: number,
  a: number,
  b: number,
  c: number
): number {
  // Validate inputs
  if (a <= 0) {
    throw new Error('Discrimination parameter (a) must be positive');
  }
  if (c < 0 || c >= 1) {
    throw new Error('Pseudo-guessing parameter (c) must be in [0, 1)');
  }

  // Calculate the exponent: -a(θ - b)
  const exponent = -a * (theta - b);

  // Calculate the denominator: 1 + e^(-a(θ - b))
  const denominator = 1 + Math.exp(exponent);

  // Calculate probability: c + (1-c) / (1 + e^(-a(θ - b)))
  const probability = c + (1 - c) / denominator;

  // Ensure probability is in valid range [c, 1.0]
  return Math.max(c, Math.min(1.0, probability));
}

/**
 * Response pattern for MLE estimation
 */
export interface ResponsePattern {
  /** Item difficulty parameter */
  b: number;
  /** Item discrimination parameter */
  a: number;
  /** Pseudo-guessing parameter */
  c: number;
  /** Whether the student answered correctly (1) or incorrectly (0) */
  response: 0 | 1;
}

/**
 * Calculate the log-likelihood of a response pattern given a theta value.
 * 
 * Log-likelihood = Σ [u_i * ln(P_i) + (1 - u_i) * ln(1 - P_i)]
 * where:
 * - u_i is the response (1 for correct, 0 for incorrect)
 * - P_i is the probability of correct response for item i
 * 
 * @param theta - Student ability parameter
 * @param patterns - Array of response patterns
 * @returns Log-likelihood value
 */
export function logLikelihood(
  theta: number,
  patterns: ResponsePattern[]
): number {
  let logLikelihood = 0;

  for (const pattern of patterns) {
    const p = probability3PL(theta, pattern.a, pattern.b, pattern.c);
    
    if (pattern.response === 1) {
      // Correct response: log(P)
      logLikelihood += Math.log(Math.max(1e-10, p)); // Avoid log(0)
    } else {
      // Incorrect response: log(1 - P)
      logLikelihood += Math.log(Math.max(1e-10, 1 - p)); // Avoid log(0)
    }
  }

  return logLikelihood;
}

/**
 * Estimate student ability (theta) using Maximum Likelihood Estimation (MLE).
 * 
 * Iterates through possible theta values (-3.0 to 3.0) to find the value
 * that maximizes the likelihood of the observed response pattern.
 * 
 * @param patterns - Array of response patterns (items answered)
 * @param stepSize - Step size for theta search (default: 0.01)
 * @param minTheta - Minimum theta value to search (default: -3.0)
 * @param maxTheta - Maximum theta value to search (default: 3.0)
 * @returns Estimated theta value that maximizes likelihood
 */
export function estimateThetaMLE(
  patterns: ResponsePattern[],
  stepSize: number = 0.01,
  minTheta: number = -3.0,
  maxTheta: number = 3.0
): number {
  if (patterns.length === 0) {
    throw new Error('At least one response pattern is required for MLE estimation');
  }

  let maxLikelihood = -Infinity;
  let bestTheta = 0.0;

  // Grid search: iterate through theta values
  for (let theta = minTheta; theta <= maxTheta; theta += stepSize) {
    const likelihood = logLikelihood(theta, patterns);

    if (likelihood > maxLikelihood) {
      maxLikelihood = likelihood;
      bestTheta = theta;
    }
  }

  return bestTheta;
}

/**
 * Calculate the standard error of theta estimate.
 * 
 * Uses the Fisher Information to estimate the standard error.
 * 
 * @param theta - Estimated theta value
 * @param patterns - Array of response patterns
 * @returns Standard error of theta estimate
 */
export function standardError(
  theta: number,
  patterns: ResponsePattern[]
): number {
  let fisherInformation = 0;

  for (const pattern of patterns) {
    const p = probability3PL(theta, pattern.a, pattern.b, pattern.c);
    const q = 1 - p;
    
    // First derivative of P with respect to theta
    const dP_dTheta = pattern.a * (p - pattern.c) * (q / (1 - pattern.c));
    
    // Fisher Information contribution
    const info = (dP_dTheta ** 2) / (p * q);
    fisherInformation += info;
  }

  // Standard error = 1 / sqrt(Fisher Information)
  if (fisherInformation <= 0) {
    return Infinity; // Cannot estimate if no information
  }

  return 1 / Math.sqrt(fisherInformation);
}

/**
 * Calculate the information function for an item at a given theta.
 * 
 * Information = a^2 * (P - c)^2 * (1 - P) / [(1 - c)^2 * P]
 * 
 * @param theta - Student ability parameter
 * @param a - Discrimination parameter
 * @param b - Difficulty parameter
 * @param c - Pseudo-guessing parameter
 * @returns Information value
 */
export function itemInformation(
  theta: number,
  a: number,
  b: number,
  c: number
): number {
  const p = probability3PL(theta, a, b, c);
  const q = 1 - p;

  // Information function formula
  const numerator = (a ** 2) * ((p - c) ** 2) * q;
  const denominator = ((1 - c) ** 2) * p;

  if (denominator === 0) {
    return 0;
  }

  return numerator / denominator;
}

/**
 * Calculate test information (sum of all item information).
 * 
 * @param theta - Student ability parameter
 * @param patterns - Array of response patterns (items in the test)
 * @returns Total test information
 */
export function testInformation(
  theta: number,
  patterns: ResponsePattern[]
): number {
  let totalInformation = 0;

  for (const pattern of patterns) {
    totalInformation += itemInformation(
      theta,
      pattern.a,
      pattern.b,
      pattern.c
    );
  }

  return totalInformation;
}
