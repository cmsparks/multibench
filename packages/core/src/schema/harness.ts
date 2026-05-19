import { z } from "zod";
import { harnessStepStatuses } from "../status.js";
import { metadataSchema, nonEmptyStringSchema } from "./common.js";

export const HarnessAttachmentSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("file"),
    path: nonEmptyStringSchema,
    description: nonEmptyStringSchema.optional(),
  }),
  z.object({
    type: z.literal("image"),
    path: nonEmptyStringSchema,
    description: nonEmptyStringSchema.optional(),
  }),
  z.object({
    type: z.literal("text"),
    name: nonEmptyStringSchema,
    content: z.string(),
  }),
]);

export const RunnerTaskSessionSchema = z.object({
  attemptId: nonEmptyStringSchema,
  taskId: nonEmptyStringSchema,
  taskTitle: nonEmptyStringSchema,
  workspaceDir: nonEmptyStringSchema,
  containerWorkspaceDir: nonEmptyStringSchema,
  artifactsDir: nonEmptyStringSchema,
  containerArtifactsDir: nonEmptyStringSchema,
  containerId: nonEmptyStringSchema,
  taskDir: nonEmptyStringSchema,
  metadata: metadataSchema,
  harnessState: z.unknown().optional(),
});

export const HarnessUsageSchema = z.object({
  inputTokens: z.number().nonnegative().optional(),
  outputTokens: z.number().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
});

export const HarnessEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("stdout"), time: nonEmptyStringSchema, text: z.string() }),
  z.object({ type: z.literal("stderr"), time: nonEmptyStringSchema, text: z.string() }),
  z.object({
    type: z.literal("assistant-message"),
    time: nonEmptyStringSchema,
    text: z.string(),
  }),
  z.object({
    type: z.literal("tool-call"),
    time: nonEmptyStringSchema,
    name: nonEmptyStringSchema,
    input: z.unknown().optional(),
  }),
  z.object({
    type: z.literal("tool-result"),
    time: nonEmptyStringSchema,
    name: nonEmptyStringSchema,
    output: z.unknown().optional(),
  }),
  z.object({
    type: z.literal("file-change"),
    time: nonEmptyStringSchema,
    path: nonEmptyStringSchema,
    action: z.enum(["created", "modified", "deleted"]),
  }),
  z.object({
    type: z.literal("usage"),
    time: nonEmptyStringSchema,
    usage: HarnessUsageSchema,
  }),
  z.object({ type: z.literal("native"), time: nonEmptyStringSchema, data: z.unknown() }),
]);

export const HarnessStepOutputSchema = z.object({
  status: z.enum(harnessStepStatuses),
  message: z.string().optional(),
  error: z
    .object({
      name: nonEmptyStringSchema.optional(),
      message: nonEmptyStringSchema,
      stack: z.string().optional(),
    })
    .optional(),
  events: z.array(HarnessEventSchema),
  usage: HarnessUsageSchema.optional(),
  nextHarnessState: z.unknown().optional(),
  nativeMetadata: metadataSchema.optional(),
});
