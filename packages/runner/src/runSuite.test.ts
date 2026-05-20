import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Harness } from "@multibench/harness";
import type { HarnessRunStepInput, HarnessStepOutput, HarnessStopInput } from "@multibench/core";
import type { LoadedTask, RunnerRunContext } from "./index.js";
import { runSuite, runTask } from "./index.js";

const temporaryDirectories: string[] = [];

type RecordingHarness = Harness & {
  inputs: HarnessRunStepInput[];
  stops: HarnessStopInput[];
  shutdownCount: number;
  maxActiveSteps: number;
};

async function createWorkspace() {
  const directory = await mkdtemp(join(tmpdir(), "multibench-execution-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeFileEnsured(path: string, contents: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}

async function createDockerCommandFixture(directory: string) {
  const dockerPath = join(directory, "docker");
  const stateDir = join(directory, "docker-state");

  await mkdir(stateDir, { recursive: true });
  await writeFile(
    dockerPath,
    `#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const stateDir = ${JSON.stringify(stateDir)};
const args = process.argv.slice(2);
mkdirSync(join(stateDir, "images"), { recursive: true });

if (args[0] === "image" && args[1] === "inspect") {
  process.exit(0);
}

if (args[0] === "run") {
  const counterPath = join(stateDir, "container-counter");
  const current = existsSync(counterPath) ? Number(readFileSync(counterPath, "utf8")) : 0;
  const next = current + 1;
  writeFileSync(counterPath, String(next));
  process.stdout.write("container-" + String(next).padStart(3, "0") + "\\n");
  process.exit(0);
}

if (args[0] === "rm") {
  process.exit(0);
}

if (args[0] === "version") {
  process.stdout.write("25.0.0\\n");
  process.exit(0);
}

process.stderr.write("unexpected docker fixture call: " + args.join(" ") + "\\n");
process.exit(2);
`,
    "utf8",
  );
  await chmod(dockerPath, 0o755);
}

function runContext(cwd: string): RunnerRunContext {
  return {
    cwd,
    runId: "run-execution-loop",
    runDir: join(cwd, ".multibench", "results", "run-execution-loop"),
    env: {
      ...process.env,
      PATH: `${cwd}:${process.env.PATH ?? ""}`,
    },
  };
}

function completedOutput(extra: Partial<HarnessStepOutput> = {}): HarnessStepOutput {
  return {
    status: "completed",
    events: [],
    ...extra,
  };
}

function createRecordingHarness(
  outputForStep: (input: HarnessRunStepInput) => HarnessStepOutput | Promise<HarnessStepOutput>,
): RecordingHarness {
  const inputs: HarnessRunStepInput[] = [];
  const stops: HarnessStopInput[] = [];
  let activeSteps = 0;
  let maxActiveSteps = 0;
  let shutdownCount = 0;

  return {
    name: "recording-harness",
    inputs,
    stops,
    get shutdownCount() {
      return shutdownCount;
    },
    get maxActiveSteps() {
      return maxActiveSteps;
    },
    async runStep(input) {
      inputs.push(input);
      activeSteps += 1;
      maxActiveSteps = Math.max(maxActiveSteps, activeSteps);
      try {
        return await outputForStep(input);
      } finally {
        activeSteps -= 1;
      }
    },
    async stop(input) {
      stops.push(input);
    },
    async shutdown() {
      shutdownCount += 1;
    },
  };
}

function loadedTaskFixture(cwd: string, stepIds: string[]): LoadedTask {
  const taskDir = join(cwd, "task");

  return {
    file: join(taskDir, "execution-loop.task.ts"),
    taskDir,
    definition: {
      id: "execution-loop",
      title: "Execution loop",
      style: [],
      source: { type: "fixture", path: "workspace" },
      environment: { image: "node:22-alpine" },
      instructions: stepIds.map((id, index) => ({
        id,
        index,
        instruction: `Complete ${id}.`,
        checks: [],
      })),
      checks: [],
      finalChecks: [],
    },
  };
}

async function createLoadedTask(cwd: string, stepIds: string[]) {
  const loadedTask = loadedTaskFixture(cwd, stepIds);
  await createDockerCommandFixture(cwd);
  await writeFileEnsured(join(loadedTask.taskDir, "workspace", "README.md"), "# fixture\n");
  return loadedTask;
}

async function writeTaskFile(cwd: string, taskId: string, stepIds: string[]) {
  const taskDir = join(cwd, "tasks", taskId);
  const taskFile = join(taskDir, `${taskId}.task.ts`);
  const steps = stepIds
    .map(
      (stepId) => `
        step({ id: ${JSON.stringify(stepId)}, checks: [] })\`
          Complete ${stepId}.
        \``,
    )
    .join(",");

  await writeFileEnsured(join(taskDir, "workspace", "README.md"), "# fixture\n");
  await writeFileEnsured(
    taskFile,
    `
      import { defineTask, dockerEnvironment, fixtureWorkspace, step } from "@multibench/tasks";

      export default defineTask({
        id: ${JSON.stringify(taskId)},
        title: ${JSON.stringify(taskId)},
        source: fixtureWorkspace({ path: "workspace" }),
        environment: dockerEnvironment({ image: "node:22-alpine" }),
        instructions: [${steps}],
      });
    `,
  );
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(async () => {
  const directories = temporaryDirectories.splice(0);
  await Promise.all(
    directories.map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

describe("runTask execution loop", () => {
  it("one task with three steps calls harness three times in order", async () => {
    const cwd = await createWorkspace();
    const loadedTask = await createLoadedTask(cwd, ["first", "second", "third"]);
    const harness = createRecordingHarness(() => completedOutput());

    const result = await runTask({
      loadedTask,
      harness,
      runContext: runContext(cwd),
    });

    expect(harness.inputs.map((input) => input.step.id)).toEqual(["first", "second", "third"]);
    expect(harness.inputs.map((input) => input.step.index)).toEqual([0, 1, 2]);
    expect(harness.inputs.map((input) => input.step.instruction)).toEqual([
      "Complete first.",
      "Complete second.",
      "Complete third.",
    ]);
    expect(harness.inputs.map((input) => input.step.metadata)).toEqual([
      { checks: [] },
      { checks: [] },
      { checks: [] },
    ]);
    expect(result.taskId).toBe("execution-loop");
    expect(result.attempts).toHaveLength(1);
  });

  it("each step receives the same session object", async () => {
    const cwd = await createWorkspace();
    const loadedTask = await createLoadedTask(cwd, ["first", "second", "third"]);
    const harness = createRecordingHarness(() => completedOutput());

    await runTask({ loadedTask, harness, runContext: runContext(cwd) });

    expect(new Set(harness.inputs.map((input) => input.session)).size).toBe(1);
    expect(harness.inputs[0]?.session).toMatchObject({
      attemptId: "attempt-001",
      taskId: "execution-loop",
      taskTitle: "Execution loop",
      taskDir: loadedTask.taskDir,
      containerWorkspaceDir: "/workspace",
      containerArtifactsDir: "/artifacts/harness",
      containerId: "container-001",
      metadata: {
        attemptIndex: 0,
        taskFile: loadedTask.file,
      },
    });
  });

  it("nextHarnessState from step 1 reaches step 2", async () => {
    const cwd = await createWorkspace();
    const loadedTask = await createLoadedTask(cwd, ["first", "second"]);
    const statesSeen: unknown[] = [];
    const harness = createRecordingHarness((input) => {
      statesSeen.push(input.session.harnessState);
      return input.step.id === "first"
        ? completedOutput({ nextHarnessState: { phase: "after-first" } })
        : completedOutput();
    });

    await runTask({ loadedTask, harness, runContext: runContext(cwd) });

    expect(statesSeen).toEqual([undefined, { phase: "after-first" }]);
  });

  it("omitted nextHarnessState keeps previous state", async () => {
    const cwd = await createWorkspace();
    const loadedTask = await createLoadedTask(cwd, ["first", "second", "third"]);
    const statesSeen: unknown[] = [];
    const harness = createRecordingHarness((input) => {
      statesSeen.push(input.session.harnessState);
      if (input.step.id === "first") {
        return completedOutput({ nextHarnessState: { durable: true } });
      }
      return completedOutput();
    });

    await runTask({ loadedTask, harness, runContext: runContext(cwd) });

    expect(statesSeen).toEqual([undefined, { durable: true }, { durable: true }]);
  });

  it("failed harness step stops remaining steps", async () => {
    const cwd = await createWorkspace();
    const loadedTask = await createLoadedTask(cwd, ["first", "second", "third"]);
    const harness = createRecordingHarness((input) =>
      input.step.id === "second"
        ? { status: "failed", message: "step failed", events: [] }
        : completedOutput(),
    );

    const result = await runTask({ loadedTask, harness, runContext: runContext(cwd) });

    expect(harness.inputs.map((input) => input.step.id)).toEqual(["first", "second"]);
    expect(result.attempts[0]?.status).toBe("failed");
    expect(result.attempts[0]?.steps.map((step) => step.stepId)).toEqual(["first", "second"]);
  });

  it("harness.stop(...) is called after completed attempt", async () => {
    const cwd = await createWorkspace();
    const loadedTask = await createLoadedTask(cwd, ["first"]);
    const harness = createRecordingHarness(() => completedOutput());

    await runTask({ loadedTask, harness, runContext: runContext(cwd) });

    expect(harness.stops).toHaveLength(1);
    expect(harness.stops[0]).toMatchObject({
      reason: "completed",
      session: harness.inputs[0]?.session,
    });
  });

  it("harness.stop(...) is called after failed attempt", async () => {
    const cwd = await createWorkspace();
    const loadedTask = await createLoadedTask(cwd, ["first", "second"]);
    const harness = createRecordingHarness((input) =>
      input.step.id === "first"
        ? { status: "failed", message: "step failed", events: [] }
        : completedOutput(),
    );

    await runTask({ loadedTask, harness, runContext: runContext(cwd) });

    expect(harness.stops).toHaveLength(1);
    expect(harness.stops[0]).toMatchObject({
      reason: "failed",
      session: harness.inputs[0]?.session,
    });
  });

  it("runs final checks after all steps and includes them in task score and artifacts", async () => {
    const cwd = await createWorkspace();
    const loadedTask = await createLoadedTask(cwd, ["first"]);
    const finalCheckPath = join(cwd, "task", "checks", "final.ts");
    await writeFileEnsured(
      finalCheckPath,
      `
        import { writeFileSync } from "node:fs";
        import { join } from "node:path";

        writeFileSync(join(process.env.MULTIBENCH_WORKSPACE_DIR!, "final-check-ran.txt"), "yes");
      `,
    );
    loadedTask.definition.finalChecks = [
      {
        id: "final-check",
        command: ["tsx", finalCheckPath],
        metadata: { runner: "host" },
      },
    ];
    const harness = createRecordingHarness(() => completedOutput());

    const result = await runTask({ loadedTask, harness, runContext: runContext(cwd) });
    const attempt = result.attempts[0]!;

    expect(attempt.finalChecks).toEqual([
      expect.objectContaining({ id: "final-check", status: "passed", exitCode: 0 }),
    ]);
    expect(attempt.score).toMatchObject({
      status: "success",
      score: 2,
      maxScore: 2,
      normalizedScore: 1,
    });
    await expect(readFile(join(attempt.workspaceDir, "final-check-ran.txt"), "utf8")).resolves.toBe(
      "yes",
    );
    await expect(
      readFile(join(attempt.artifactDir, "final-checks", "final-check", "result.json"), "utf8"),
    ).resolves.toContain('"status": "passed"');
  });

  it("attempts: 3 runs three isolated attempts", async () => {
    const cwd = await createWorkspace();
    const loadedTask = await createLoadedTask(cwd, ["first"]);
    const harness = createRecordingHarness(() => completedOutput());

    const result = await runTask({
      loadedTask,
      harness,
      runContext: runContext(cwd),
      attempts: 3,
    });

    expect(result.attempts.map((attempt) => attempt.attemptId)).toEqual([
      "attempt-001",
      "attempt-002",
      "attempt-003",
    ]);
    expect(new Set(harness.inputs.map((input) => input.session.workspaceDir)).size).toBe(3);
    expect(new Set(harness.inputs.map((input) => input.session.artifactsDir)).size).toBe(3);
    expect(new Set(harness.inputs.map((input) => input.session.containerId)).size).toBe(3);
  });
});

describe("runSuite execution loop", () => {
  it("harness.shutdown(...) is called once after suite", async () => {
    const cwd = await createWorkspace();
    await createDockerCommandFixture(cwd);
    await writeTaskFile(cwd, "first-task", ["first"]);
    await writeTaskFile(cwd, "second-task", ["first"]);
    const harness = createRecordingHarness(() => completedOutput());

    const result = await runSuite({
      cwd,
      taskPatterns: ["tasks/**/*.task.ts"],
      harness,
      runId: "run-suite-shutdown",
      env: runContext(cwd).env,
    });

    expect(result.runId).toBe("run-suite-shutdown");
    expect(harness.shutdownCount).toBe(1);
  });

  it("concurrency: 2 limits concurrent attempts to two", async () => {
    const cwd = await createWorkspace();
    await createDockerCommandFixture(cwd);
    await writeTaskFile(cwd, "first-task", ["first"]);
    await writeTaskFile(cwd, "second-task", ["first"]);
    const harness = createRecordingHarness(async () => {
      await delay(50);
      return completedOutput();
    });

    await runSuite({
      cwd,
      taskPatterns: ["tasks/**/*.task.ts"],
      harness,
      runId: "run-suite-concurrency",
      attempts: 2,
      concurrency: 2,
      env: runContext(cwd).env,
    });

    expect(harness.inputs).toHaveLength(4);
    expect(harness.maxActiveSteps).toBe(2);
  });
});
