import { z } from "zod";
import { CheckDefinitionSchema } from "./checks.js";
import { metadataSchema, nonEmptyStringSchema, stringRecordSchema } from "./common.js";
import { HarnessAttachmentSchema } from "./harness.js";

export const WorkspaceSourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("fixture"), path: nonEmptyStringSchema }),
  z.object({
    type: z.literal("git"),
    url: nonEmptyStringSchema,
    ref: nonEmptyStringSchema,
    submodules: z.boolean().optional(),
  }),
  z.object({ type: z.literal("archive"), path: nonEmptyStringSchema }),
]);

const DockerEnvironmentBaseSchema = z.object({
  dockerfile: nonEmptyStringSchema.optional(),
  context: nonEmptyStringSchema.optional(),
  image: nonEmptyStringSchema.optional(),
  buildArgs: stringRecordSchema.optional(),
  env: stringRecordSchema.optional(),
  workingDir: nonEmptyStringSchema.optional(),
});

export const DockerEnvironmentSchema = DockerEnvironmentBaseSchema.superRefine((value, ctx) => {
  if (!value.dockerfile && !value.context && !value.image) {
    ctx.addIssue({
      code: "custom",
      message: "Docker environment must define dockerfile, context, or image",
      path: ["dockerfile"],
    });
  }
});

export const NormalizedStepSchema = z.object({
  id: nonEmptyStringSchema,
  index: z.number().int().nonnegative(),
  instruction: nonEmptyStringSchema,
  checks: z.array(CheckDefinitionSchema),
  attachments: z.array(HarnessAttachmentSchema).optional(),
  timeoutMs: z.number().int().positive().optional(),
  metadata: metadataSchema.optional(),
});

export const NormalizedTaskDefinitionSchema = z
  .object({
    id: nonEmptyStringSchema,
    title: nonEmptyStringSchema,
    style: z.array(nonEmptyStringSchema),
    source: WorkspaceSourceSchema,
    environment: DockerEnvironmentSchema,
    instructions: z.array(NormalizedStepSchema).min(1, "Task must contain at least one step"),
    checks: z.array(CheckDefinitionSchema),
    finalChecks: z.array(CheckDefinitionSchema),
    metadata: metadataSchema.optional(),
  })
  .superRefine((task, ctx) => {
    const seenSteps = new Set<string>();
    for (const [index, step] of task.instructions.entries()) {
      if (seenSteps.has(step.id)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate step id "${step.id}"`,
          path: ["instructions", index, "id"],
        });
      }
      seenSteps.add(step.id);

      if (step.index !== index) {
        ctx.addIssue({
          code: "custom",
          message: `Step "${step.id}" index must match its array position`,
          path: ["instructions", index, "index"],
        });
      }
    }

    const seenChecks = new Set<string>();
    for (const [index, check] of task.checks.entries()) {
      if (seenChecks.has(check.id)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate check id "${check.id}"`,
          path: ["checks", index, "id"],
        });
      }
      seenChecks.add(check.id);
    }
  });
