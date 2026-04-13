import { describe, it, expect } from 'vitest';
import { routeToNextModule } from './ModuleRouter';

describe('Module Router', () => {
  // Test the "Cut Score" logic
  it('routes to HARD module when score is equal to threshold', () => {
    // Threshold is 12. Student gets 12.
    const nextMod = routeToNextModule(12, 12);
    expect(nextMod).toBe('rw_module_2_hard');
  });

  it('routes to HARD module when score is above threshold', () => {
    // Threshold is 12. Student gets 15.
    const nextMod = routeToNextModule(15, 12);
    expect(nextMod).toBe('rw_module_2_hard');
  });

  it('routes to EASY module when score is below threshold', () => {
    // Threshold is 12. Student gets 10.
    const nextMod = routeToNextModule(10, 12);
    expect(nextMod).toBe('rw_module_2_easy');
  });

  it('handles edge case of 0 score', () => {
    const nextMod = routeToNextModule(0, 12);
    expect(nextMod).toBe('rw_module_2_easy');
  });
});
