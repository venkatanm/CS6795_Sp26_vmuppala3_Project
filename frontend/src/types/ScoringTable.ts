export interface ScoringEntry {
  theta_range: [number, number]; // e.g. [-3.0, -2.5]
  score: number;                 // e.g. 200
}

export type ScoringTable = ScoringEntry[];

export interface ScoringConfig {
  default_score: number;
  math: ScoringTable;
  rw: ScoringTable;
}
