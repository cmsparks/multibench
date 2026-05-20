import { z } from "zod";
import { checkStatuses } from "../status.js";
import { metadataSchema, nonEmptyStringSchema, stringRecordSchema } from "./common.js";

export const CheckDefinitionSchema = z.object({
  id: nonEmptyStringSchema,
  command: z.array(nonEmptyStringSchema).min(1, "Check command must contain at least one argument"),
  cwd: nonEmptyStringSchema.optional(),
  timeoutMs: z.number().int().positive().optional(),
  env: stringRecordSchema.optional(),
  metadata: metadataSchema.optional(),
});

export const CheckResultSchema = z.object({
  id: nonEmptyStringSchema,
  status: z.enum(checkStatuses),
  command: z.array(nonEmptyStringSchema).min(1, "Check command must contain at least one argument"),
  cwd: nonEmptyStringSchema,
  exitCode: z.number().int().optional(),
  stdoutPath: nonEmptyStringSchema,
  stderrPath: nonEmptyStringSchema,
  durationMs: z.number().nonnegative(),
  metadata: metadataSchema.optional(),
});
