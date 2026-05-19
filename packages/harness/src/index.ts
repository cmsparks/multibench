import { mkdir, writeFile } from "node:fs/promises";
import { dirname, posix, relative, resolve, sep } from "node:path";
import type {
  HarnessEvent,
  HarnessRunStepInput,
  HarnessStepOutput,
  HarnessStopInput,
} from "@multibench/core";
import {
  HarnessEventSchema,
  HarnessStepOutputSchema,
  parseSchema,
} from "@multibench/core";

export const harnessPackageName = "@multibench/harness";

export type {
  HarnessAttachment,
  HarnessEvent,
  HarnessRunStepInput,
  HarnessStepOutput,
  HarnessStopInput,
  RunnerTaskSession,
} from "@multibench/core";

export type Harness = {
  name: string;
  version?: string;
  config?: unknown;
  configure?: (options: unknown) => void | Promise<void>;
  runStep: (input: HarnessRunStepInput) => Promise<HarnessStepOutput>;
  stop?: (input: HarnessStopInput) => Promise<void>;
  shutdown?: () => Promise<void>;
};

export function defineHarness(harness: Harness): Harness {
  validateHarness(harness);
  return harness;
}

export function validateHarness(harness: unknown): asserts harness is Harness {
  if (typeof harness !== "object" || harness === null) {
    throw new TypeError("Invalid harness: expected an object");
  }

  const candidate = harness as Partial<Harness>;

  if (typeof candidate.name !== "string" || candidate.name.trim() === "") {
    throw new TypeError("Invalid harness: name must be a non-empty string");
  }

  if (candidate.version !== undefined && typeof candidate.version !== "string") {
    throw new TypeError("Invalid harness: version must be a string when provided");
  }

  if (candidate.configure !== undefined && typeof candidate.configure !== "function") {
    throw new TypeError("Invalid harness: configure must be a function when provided");
  }

  if (typeof candidate.runStep !== "function") {
    throw new TypeError("Invalid harness: runStep must be a function");
  }

  if (candidate.stop !== undefined && typeof candidate.stop !== "function") {
    throw new TypeError("Invalid harness: stop must be a function when provided");
  }

  if (candidate.shutdown !== undefined && typeof candidate.shutdown !== "function") {
    throw new TypeError("Invalid harness: shutdown must be a function when provided");
  }
}

export type MockHarnessScriptedStep =
  | HarnessStepOutput
  | ((input: HarnessRunStepInput) => HarnessStepOutput | Promise<HarnessStepOutput>);

export type MockHarnessOptions = {
  name?: string;
  version?: string;
  steps: MockHarnessScriptedStep[];
  initialHarnessState?: unknown;
};

export function createMockHarness(options: MockHarnessOptions): Harness {
  if (!Array.isArray(options.steps)) {
    throw new TypeError("Invalid mock harness: steps must be an array");
  }

  let cursor = 0;
  const scriptedSteps = [...options.steps];

  const harness = defineHarness({
    name: options.name ?? "mock",
    version: options.version,
    async runStep(input) {
      if (cursor === 0 && input.session.harnessState === undefined) {
        input.session.harnessState = options.initialHarnessState;
      }

      const scriptedStep = scriptedSteps[cursor];
      cursor += 1;

      if (scriptedStep === undefined) {
        throw new Error(`Mock harness has no scripted output for step ${input.step.id}`);
      }

      const output =
        typeof scriptedStep === "function" ? await scriptedStep(input) : scriptedStep;

      return parseSchema(HarnessStepOutputSchema, output, "harness step output");
    },
  });

  return harness;
}

export async function writeHarnessEventsJsonl(
  path: string,
  events: HarnessEvent[],
): Promise<void> {
  const validatedEvents = events.map((event) =>
    parseSchema(HarnessEventSchema, event, "harness event"),
  );
  const jsonl = validatedEvents.map((event) => JSON.stringify(event)).join("\n");

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${jsonl}\n`, "utf8");
}

export function resolveContainerPath(input: {
  hostPath: string;
  hostRoot: string;
  containerRoot: string;
}): string {
  const relativePath = relative(resolve(input.hostRoot), resolve(input.hostPath));

  if (relativePath.startsWith("..") || relativePath === "..") {
    throw new Error(`Host path is outside host root: ${input.hostPath}`);
  }

  if (relativePath === "") {
    return input.containerRoot;
  }

  return posix.join(input.containerRoot, relativePath.split(sep).join(posix.sep));
}

export function resolveHostPath(input: {
  containerPath: string;
  hostRoot: string;
  containerRoot: string;
}): string {
  const containerRoot = posix.resolve(input.containerRoot);
  const containerPath = posix.resolve(input.containerPath);
  const relativePath = posix.relative(containerRoot, containerPath);

  if (relativePath.startsWith("..") || relativePath === "..") {
    throw new Error(`Container path is outside container root: ${input.containerPath}`);
  }

  if (relativePath === "") {
    return resolve(input.hostRoot);
  }

  return resolve(input.hostRoot, relativePath);
}
