import type { AttemptStatus, HarnessStepStatus, RunStatus } from "../status.js";
import type { CheckResult } from "../types/checks.js";
import type { HarnessStepOutput } from "../types/harness.js";
import type { StepScore, SuiteSummary, TaskScore, TaskSummary } from "../scoring/types.js";

export type StepRunResult = {
  stepId: string;
  stepIndex: number;
  status: HarnessStepStatus;
  harness: HarnessStepOutput;
  checks: CheckResult[];
  score: StepScore;
  durationMs: number;
  artifactDir?: string;
  diffPath?: string;
  startedAt?: string;
  completedAt?: string;
};

export type TaskAttemptResult = {
  attemptId: string;
  taskId: string;
  workspaceDir: string;
  containerWorkspaceDir: string;
  containerId: string;
  artifactDir: string;
  status: AttemptStatus;
  steps: StepRunResult[];
  score: TaskScore;
  startedAt?: string;
  completedAt?: string;
};

export type TaskRunResult = {
  taskId: string;
  taskTitle: string;
  attempts: TaskAttemptResult[];
  summary: TaskSummary;
};

export type SuiteRunResult = {
  runId: string;
  runDir: string;
  startedAt: string;
  completedAt: string;
  status: RunStatus;
  tasks: TaskRunResult[];
  summary: SuiteSummary;
};
