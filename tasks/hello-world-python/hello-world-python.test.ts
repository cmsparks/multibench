import { cp, mkdtemp, rm, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { loadTask } from "@multibench/runner";

const execFileAsync = promisify(execFile);
const taskFile = new URL("./hello-world-python.task.ts", import.meta.url).pathname;
const taskDir = dirname(taskFile);

async function copyBaseline() {
  const directory = await mkdtemp(join(tmpdir(), "multibench-hello-world-"));
  await cp(join(taskDir, "workspace"), directory, { recursive: true });
  return directory;
}

async function runCheck(workspaceDir: string, check: string) {
  return execFileAsync(process.execPath, [join(taskDir, "checks", check)], {
    cwd: workspaceDir,
    env: {
      ...process.env,
      MULTIBENCH_WORKSPACE_DIR: workspaceDir,
    },
  });
}

async function applySolutionPatch(workspaceDir: string, stepId: string) {
  return execFileAsync("git", ["apply", "--recount", join(taskDir, "solution", `${stepId}.patch`)], {
    cwd: workspaceDir,
    env: {
      ...process.env,
      GIT_CEILING_DIRECTORIES: dirname(workspaceDir),
    },
  });
}

describe("hello world python task", () => {
  it("loads and defines the expected two-step workflow", async () => {
    const loaded = await loadTask(taskFile, { cwd: taskDir });

    expect(loaded.definition).toMatchObject({
      id: "hello-world-python",
      title: "Hello world Python",
      environment: { dockerfile: "Dockerfile" },
      source: { type: "fixture", path: "workspace" },
    });
    expect(loaded.definition.instructions.map((step) => step.id)).toEqual([
      "write-hello-world",
      "loop-five-times",
    ]);
    expect(loaded.definition.instructions.flatMap((step) => step.checks)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "hello-world-output", metadata: { runner: "host" } }),
        expect.objectContaining({ id: "hello-world-loop", metadata: { runner: "host" } }),
      ]),
    );
  });

  it("has Docker, workspace, check, and solution files", async () => {
    await expect(stat(join(taskDir, "Dockerfile"))).resolves.toBeTruthy();
    await expect(stat(join(taskDir, "workspace", "README.md"))).resolves.toBeTruthy();
    await expect(stat(join(taskDir, "checks", "hello.ts"))).resolves.toBeTruthy();
    await expect(stat(join(taskDir, "checks", "loop.ts"))).resolves.toBeTruthy();
    await expect(stat(join(taskDir, "solution", "write-hello-world.patch"))).resolves.toBeTruthy();
    await expect(stat(join(taskDir, "solution", "loop-five-times.patch"))).resolves.toBeTruthy();
  });

  it("baseline fails both checks", async () => {
    const workspace = await copyBaseline();
    try {
      await expect(runCheck(workspace, "hello.ts")).rejects.toThrow();
      await expect(runCheck(workspace, "loop.ts")).rejects.toThrow();
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("solution patches apply step-by-step and pass corresponding checks", async () => {
    const workspace = await copyBaseline();
    try {
      await applySolutionPatch(workspace, "write-hello-world");
      await expect(runCheck(workspace, "hello.ts")).resolves.toBeTruthy();
      await expect(runCheck(workspace, "loop.ts")).rejects.toThrow();

      await applySolutionPatch(workspace, "loop-five-times");
      await expect(runCheck(workspace, "loop.ts")).resolves.toBeTruthy();
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
