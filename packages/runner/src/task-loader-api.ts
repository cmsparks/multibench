import type { CheckDefinition, NormalizedTaskDefinition } from "@multibench/core";
import { defineTask as defineAuthoringTask, type TaskAuthoringDefinition } from "@multibench/tasks";

export {
  archiveWorkspace,
  dockerEnvironment,
  fixtureWorkspace,
  gitRepo,
  step,
} from "@multibench/tasks";

export function defineTask(definition: TaskAuthoringDefinition): NormalizedTaskDefinition {
  const normalized = defineAuthoringTask({
    source: { type: "fixture", path: "." },
    ...definition,
  });

  return {
    ...normalized,
    instructions: normalized.instructions.map((instruction) => ({
      ...instruction,
      checks: instruction.checks.map(normalizeLoadedCheckCommand),
    })),
    checks: normalized.checks.map(normalizeLoadedCheckCommand),
    finalChecks: normalized.finalChecks.map(normalizeLoadedCheckCommand),
  };
}

function normalizeLoadedCheckCommand(check: CheckDefinition): CheckDefinition {
  if (check.command[0] !== "vitest") {
    return check;
  }

  return {
    ...check,
    command: ["pnpm", ...check.command],
  };
}
