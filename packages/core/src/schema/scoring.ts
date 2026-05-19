import { z } from "zod";
import { stepScoreStatuses } from "../status.js";
import { metadataSchema, nonEmptyStringSchema } from "./common.js";

export const ScorePartResultSchema = z.object({
  id: nonEmptyStringSchema,
  label: z.string().optional(),
  status: z.enum(stepScoreStatuses),
  score: z.number().nonnegative(),
  maxScore: z.number().nonnegative(),
  message: z.string().optional(),
  metadata: metadataSchema.optional(),
});

export const StepScoreSchema = z.object({
  stepId: nonEmptyStringSchema,
  status: z.enum(stepScoreStatuses),
  score: z.number().nonnegative(),
  maxScore: z.number().nonnegative(),
  parts: z.array(ScorePartResultSchema),
});

export const TaskScoreSchema = z.object({
  status: z.enum(stepScoreStatuses),
  score: z.number().nonnegative(),
  maxScore: z.number().nonnegative(),
  normalizedScore: z.number().min(0).max(1),
  stepScores: z.array(StepScoreSchema),
});

export const TaskSummarySchema = z.object({
  attempts: z.number().int().nonnegative(),
  completedAttempts: z.number().int().nonnegative(),
  failedAttempts: z.number().int().nonnegative(),
  bestScore: z.number().nonnegative(),
  maxScore: z.number().nonnegative(),
  bestNormalizedScore: z.number().min(0).max(1),
});

export const SuiteSummarySchema = z.object({
  tasks: z.number().int().nonnegative(),
  attempts: z.number().int().nonnegative(),
  completedTasks: z.number().int().nonnegative(),
  failedTasks: z.number().int().nonnegative(),
  score: z.number().nonnegative(),
  maxScore: z.number().nonnegative(),
  normalizedScore: z.number().min(0).max(1),
});
