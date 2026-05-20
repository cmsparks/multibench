import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadHarness, parseCliArgs, runCli } from "./index.js";

const temporaryDirectories: string[] = [];

async function createWorkspace() {
  const directory = await mkdtemp(join(tmpdir(), "multibench-cli-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeFileEnsured(path: string, contents: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}

afterEach(async () => {
  const directories = temporaryDirectories.splice(0);
  await Promise.all(
    directories.map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

describe("parseCliArgs", () => {
  it("multibench run uses default task glob", () => {
    expect(parseCliArgs(["run"])).toMatchObject({
      command: "run",
      taskPatterns: ["tasks/**/*.task.ts"],
    });
  });

  it("task positional args map to taskPatterns", () => {
    expect(parseCliArgs(["run", "tasks/a.task.ts", "tasks/b"])).toMatchObject({
      taskPatterns: ["tasks/a.task.ts", "tasks/b"],
    });
  });

  it("--runs and --concurrent map to runner options", () => {
    expect(parseCliArgs(["run", "--runs", "3", "--concurrent", "2"])).toMatchObject({
      attempts: 3,
      concurrency: 2,
    });
  });

  it("harness path and dotted options parse conservatively", () => {
    expect(
      parseCliArgs([
        "run",
        "--harness",
        "./x.harness.ts",
        "--harness.api_key",
        "key",
        "--harness.model",
        "model-string",
        "--harness.env.BASE_URL",
        "https://example.test",
        "--harness.max_turns",
        "80",
        "--harness.flag",
        "true",
        "--harness.tag",
        "a",
        "--harness.tag",
        "b",
      ]),
    ).toMatchObject({
      harnessPath: "./x.harness.ts",
      harnessOptions: {
        api_key: "key",
        model: "model-string",
        env: { BASE_URL: "https://example.test" },
        max_turns: 80,
        flag: true,
        tag: ["a", "b"],
      },
    });
  });

  it("timeout flags parse human-readable durations", () => {
    expect(
      parseCliArgs([
        "run",
        "--timeout-step",
        "15m",
        "--timeout-check",
        "2m",
        "--timeout-task",
        "1h",
        "--timeout-suite",
        "6h",
      ]),
    ).toMatchObject({
      timeouts: {
        stepMs: 900_000,
        checkMs: 120_000,
        taskMs: 3_600_000,
        suiteMs: 21_600_000,
      },
    });
  });

  it("non-path harness spec fails", () => {
    expect(() => parseCliArgs(["run", "--harness", "claude-code"])).toThrow(/path/i);
  });
});

describe("loadHarness", () => {
  it("loads default export harness and calls configure", async () => {
    const cwd = await createWorkspace();
    const harnessPath = join(cwd, "x.harness.ts");
    await writeFileEnsured(
      harnessPath,
      `
        export default {
          name: "configured",
          configured: undefined,
          configure(options) {
            this.configured = options;
          },
          async runStep() {
            return { status: "completed", events: [] };
          },
        };
      `,
    );

    const harness = await loadHarness({ path: harnessPath, cwd, options: { api_key: "key" } });

    expect(harness.name).toBe("configured");
    expect(harness).toMatchObject({ configured: { api_key: "key" } });
  });

  it("loads named harness export", async () => {
    const cwd = await createWorkspace();
    const harnessPath = join(cwd, "named.harness.ts");
    await writeFileEnsured(
      harnessPath,
      `
        export const harness = {
          name: "named",
          async runStep() {
            return { status: "completed", events: [] };
          },
        };
      `,
    );

    await expect(loadHarness({ path: harnessPath, cwd })).resolves.toMatchObject({ name: "named" });
  });
});

describe("runCli", () => {
  it("--dry-run and --list do not invoke harness and print matched tasks", async () => {
    const cwd = await createWorkspace();
    await writeFileEnsured(
      join(cwd, "tasks", "demo.task.ts"),
      `
        import { defineTask, dockerEnvironment, fixtureWorkspace, step } from "@multibench/tasks";
        export default defineTask({
          id: "demo",
          title: "Demo",
          source: fixtureWorkspace({ path: "workspace" }),
          environment: dockerEnvironment({ image: "node:22-alpine" }),
          instructions: [step({ id: "first", checks: [] })\`Do it.\`],
        });
      `,
    );
    await writeFileEnsured(join(cwd, "tasks", "workspace", "README.md"), "# demo\n");

    const output: string[] = [];
    const exitCode = await runCli(["run", "--dry-run", "--list"], {
      cwd,
      stdout: (line) => output.push(line),
    });

    expect(exitCode).toBe(0);
    expect(output.join("\n")).toContain("demo");
  });

  it("multibench list prints matched tasks", async () => {
    const cwd = await createWorkspace();
    await writeFileEnsured(
      join(cwd, "tasks", "demo.task.ts"),
      `
        import { defineTask, dockerEnvironment, fixtureWorkspace, step } from "@multibench/tasks";
        export default defineTask({
          id: "demo",
          title: "Demo",
          source: fixtureWorkspace({ path: "workspace" }),
          environment: dockerEnvironment({ image: "node:22-alpine" }),
          instructions: [step({ id: "first", checks: [] })\`Do it.\`],
        });
      `,
    );
    await writeFileEnsured(join(cwd, "tasks", "workspace", "README.md"), "# demo\n");

    const output: string[] = [];
    await expect(runCli(["list"], { cwd, stdout: (line) => output.push(line) })).resolves.toBe(0);
    expect(output.join("\n")).toContain("demo");
  });

  it("multibench validate catches invalid tasks", async () => {
    const cwd = await createWorkspace();
    await writeFileEnsured(
      join(cwd, "tasks", "invalid.task.ts"),
      `
        export default { id: "invalid" };
      `,
    );

    const errors: string[] = [];
    await expect(runCli(["validate"], { cwd, stderr: (line) => errors.push(line) })).resolves.toBe(
      1,
    );
    expect(errors.join("\n")).toMatch(/invalid|title/i);
  });

  it("multibench replay reads existing suite artifacts without invoking harness", async () => {
    const cwd = await createWorkspace();
    const runDir = join(cwd, ".multibench", "results", "run-replay");
    await writeFileEnsured(
      join(runDir, "suite-result.json"),
      JSON.stringify({
        runId: "run-replay",
        runDir,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        status: "completed",
        tasks: [],
        summary: {
          tasks: 0,
          attempts: 0,
          completedTasks: 0,
          failedTasks: 0,
          score: 0,
          maxScore: 0,
          normalizedScore: 0,
        },
      }),
    );

    const output: string[] = [];
    await expect(
      runCli(["replay", "run-replay"], { cwd, stdout: (line) => output.push(line) }),
    ).resolves.toBe(0);
    expect(output.join("\n")).toContain("run-replay");
  });
});
