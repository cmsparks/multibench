export const harnessStepStatuses = [
  "completed",
  "failed",
  "timed-out",
  "cancelled",
] as const;

export type HarnessStepStatus = (typeof harnessStepStatuses)[number];

export const checkStatuses = ["passed", "failed", "timed-out", "skipped"] as const;

export type CheckStatus = (typeof checkStatuses)[number];

export const stepScoreStatuses = ["success", "partial", "failure"] as const;

export type StepScoreStatus = (typeof stepScoreStatuses)[number];

export const taskStatuses = ["completed", "failed", "timed-out", "cancelled"] as const;

export type TaskStatus = (typeof taskStatuses)[number];

export const attemptStatuses = taskStatuses;

export type AttemptStatus = TaskStatus;

export const runStatuses = ["completed", "failed", "cancelled"] as const;

export type RunStatus = (typeof runStatuses)[number];
