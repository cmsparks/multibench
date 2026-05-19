import type { StepScoreStatus } from "../status.js";

export type ScorePartResult = {
  id: string;
  label?: string;
  status: StepScoreStatus;
  score: number;
  maxScore: number;
  message?: string;
  metadata?: Record<string, unknown>;
};

export type StepScore = {
  stepId: string;
  status: StepScoreStatus;
  score: number;
  maxScore: number;
  parts: ScorePartResult[];
};

export type TaskScore = {
  status: StepScoreStatus;
  score: number;
  maxScore: number;
  normalizedScore: number;
  stepScores: StepScore[];
};

export type TaskSummary = {
  attempts: number;
  completedAttempts: number;
  failedAttempts: number;
  bestScore: number;
  maxScore: number;
  bestNormalizedScore: number;
};

export type SuiteSummary = {
  tasks: number;
  attempts: number;
  completedTasks: number;
  failedTasks: number;
  score: number;
  maxScore: number;
  normalizedScore: number;
};
