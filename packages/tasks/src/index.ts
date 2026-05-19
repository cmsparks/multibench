import type {
  CheckReference,
  CheckDefinition,
  DockerEnvironment,
  NormalizedTaskDefinition,
  NormalizedStep,
  TaskDefinition,
  TaskStepDefinition,
  WorkspaceSource,
} from "@multibench/core";
import { parseNormalizedTaskDefinition } from "@multibench/core";
import deindent from "deindent";

export const tasksPackageName = "@multibench/tasks";

export type StepOptions = {
  id: string;
  checks?: CheckReference[];
  attachments?: TaskStepDefinition["attachments"];
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
};

export type TaskAuthoringDefinition = Omit<
  TaskDefinition,
  "environment" | "instructions"
> & {
  environment?: DockerEnvironment;
  instructions: TaskStepDefinition[];
};

export function defineTask(definition: TaskAuthoringDefinition): NormalizedTaskDefinition {
  const source = definition.source ?? definition.repo;

  if (!source) {
    throw new Error("Task must define a workspace source");
  }

  const instructions = definition.instructions.map((instruction, index): NormalizedStep => {
    const checks = normalizeCheckReferences(instruction.id, instruction.checks);

    return stripUndefinedProperties({
      id: instruction.id,
      index,
      instruction: instruction.instruction,
      checks,
      attachments: instruction.attachments,
      timeoutMs: instruction.timeoutMs,
      metadata: instruction.metadata,
    });
  });

  const normalized = stripUndefinedProperties({
    id: definition.id,
    title: definition.title,
    style: definition.style ?? [],
    source,
    environment: definition.environment,
    instructions,
    checks: instructions.flatMap((instruction) => instruction.checks),
    finalChecks: definition.finalChecks ?? [],
    metadata: definition.metadata,
  });

  return parseNormalizedTaskDefinition(normalized);
}

export function step(
  options: StepOptions,
): (strings: TemplateStringsArray, ...values: unknown[]) => TaskStepDefinition {
  return (strings: TemplateStringsArray, ...values: unknown[]): TaskStepDefinition => {
    if (values.length > 0) {
      throw new Error("Step instruction templates do not allow interpolation");
    }

    const instruction = normalizeInstructionText(strings[0] ?? "");

    return stripUndefinedProperties({
      id: options.id,
      instruction,
      checks: options.checks,
      attachments: options.attachments,
      timeoutMs: options.timeoutMs,
      metadata: options.metadata,
    });
  };
}

export function dockerEnvironment(environment: DockerEnvironment): DockerEnvironment {
  return environment;
}

export function gitRepo(
  source: Omit<Extract<WorkspaceSource, { type: "git" }>, "type">,
): WorkspaceSource {
  return { type: "git", ...source };
}

export function fixtureWorkspace(
  source: Omit<Extract<WorkspaceSource, { type: "fixture" }>, "type">,
): WorkspaceSource {
  return { type: "fixture", ...source };
}

export function archiveWorkspace(
  source: Omit<Extract<WorkspaceSource, { type: "archive" }>, "type">,
): WorkspaceSource {
  return { type: "archive", ...source };
}

function normalizeCheckReferences(stepId: string, checks?: CheckReference[]): CheckDefinition[] {
  const references = checks ?? [`tests/${stepId}.test.ts`];

  return references.map((reference) => {
    if (typeof reference === "string") {
      return {
        id: stepId,
        command: ["vitest", "run", reference],
      };
    }

    return reference;
  });
}

function normalizeInstructionText(value: string): string {
  const blankLineSentinel = "\u0000MULTIBENCH_BLANK_LINE\u0000";
  const protectedValue = value
    .split("\n")
    .map((line) => (line.trim() === "" ? blankLineSentinel : line))
    .join("\n");

  return deindent(protectedValue)
    .replaceAll(blankLineSentinel, "")
    .trim();
}

function stripUndefinedProperties<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, propertyValue]) => propertyValue !== undefined),
  ) as T;
}
