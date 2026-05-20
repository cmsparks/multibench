import { z } from "zod";
import { attemptStatuses, harnessStepStatuses, runStatuses } from "../status.js";
import { CheckResultSchema } from "./checks.js";
import { isoDateTimeStringSchema, nonEmptyStringSchema } from "./common.js";
import { HarnessStepOutputSchema } from "./harness.js";
import {
  StepScoreSchema,
  SuiteSummarySchema,
  TaskScoreSchema,
  TaskSummarySchema,
} from "./scoring.js";

export const StepRunResultSchema = z.object({
  stepId: nonEmptyStringSchema,
  stepIndex: z.number().int().nonnegative(),
  status: z.enum(harnessStepStatuses),
  harness: HarnessStepOutputSchema,
  checks: z.array(CheckResultSchema),
  score: StepScoreSchema,
  durationMs: z.number().nonnegative(),
  artifactDir: nonEmptyStringSchema.optional(),
  diffPath: nonEmptyStringSchema.optional(),
  startedAt: isoDateTimeStringSchema.optional(),
  completedAt: isoDateTimeStringSchema.optional(),
});

export const TaskAttemptResultSchema = z.object({
  attemptId: nonEmptyStringSchema,
  taskId: nonEmptyStringSchema,
  workspaceDir: nonEmptyStringSchema,
  containerWorkspaceDir: nonEmptyStringSchema,
  containerId: nonEmptyStringSchema,
  artifactDir: nonEmptyStringSchema,
  status: z.enum(attemptStatuses),
  steps: z.array(StepRunResultSchema),
  finalChecks: z.array(CheckResultSchema),
  score: TaskScoreSchema,
  startedAt: isoDateTimeStringSchema.optional(),
  completedAt: isoDateTimeStringSchema.optional(),
});

export const TaskRunResultSchema = z.object({
  taskId: nonEmptyStringSchema,
  taskTitle: nonEmptyStringSchema,
  attempts: z.array(TaskAttemptResultSchema),
  summary: TaskSummarySchema,
});

export const SuiteRunResultSchema = z.object({
  runId: nonEmptyStringSchema,
  runDir: nonEmptyStringSchema,
  startedAt: isoDateTimeStringSchema,
  completedAt: isoDateTimeStringSchema,
  status: z.enum(runStatuses),
  tasks: z.array(TaskRunResultSchema),
  summary: SuiteSummarySchema,
});
