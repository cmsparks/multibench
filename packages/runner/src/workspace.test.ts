import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type { LoadedTask } from "./index.js";
import {
  cleanupAttemptWorkspace,
  defaultAttemptId,
  materializeWorkspaceSource,
  prepareAttemptWorkspace,
} from "./workspace.js";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

async function createWorkspace() {
  const directory = await mkdtemp(join(tmpdir(), "multibench-workspace-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeFileEnsured(path: string, contents: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}

function loadedTaskFixture(directory: string): LoadedTask {
  return {
    file: join(directory, "example.task.ts"),
    taskDir: directory,
    definition: {
      id: "example-task",
      title: "Example task",
      style: [],
      source: { type: "fixture", path: "fixture" },
      environment: { dockerfile: "Dockerfile" },
      instructions: [],
      checks: [],
      finalChecks: [],
    },
  };
}

afterEach(async () => {
  const directories = temporaryDirectories.splice(0);
  await Promise.all(
    directories.map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

describe("workspace lifecycle", () => {
  it("materializes fixture workspaces", async () => {
    const cwd = await createWorkspace();
    await writeFileEnsured(join(cwd, "task", "fixture", "src", "index.js"), "console.log('ok');\n");

    await materializeWorkspaceSource({
      source: { type: "fixture", path: "fixture" },
      taskDir: join(cwd, "task"),
      destination: join(cwd, "attempt-workspace"),
    });

    await expect(readFile(join(cwd, "attempt-workspace", "src", "index.js"), "utf8")).resolves.toBe(
      "console.log('ok');\n",
    );
  });

  it("materializes archive workspaces", async () => {
    const cwd = await createWorkspace();
    await writeFileEnsured(join(cwd, "archive-source", "README.md"), "# archived\n");
    await execFileAsync("tar", [
      "-cf",
      join(cwd, "workspace.tar"),
      "-C",
      join(cwd, "archive-source"),
      ".",
    ]);

    await materializeWorkspaceSource({
      source: { type: "archive", path: "workspace.tar" },
      taskDir: cwd,
      destination: join(cwd, "archive-workspace"),
    });

    await expect(readFile(join(cwd, "archive-workspace", "README.md"), "utf8")).resolves.toBe(
      "# archived\n",
    );
  });

  it("materializes git workspaces at the configured ref", async () => {
    const cwd = await createWorkspace();
    const repo = join(cwd, "repo");
    await mkdir(repo, { recursive: true });
    await execFileAsync("git", ["init"], { cwd: repo });
    await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: repo });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
    await writeFileEnsured(join(repo, "version.txt"), "one\n");
    await execFileAsync("git", ["add", "version.txt"], { cwd: repo });
    await execFileAsync("git", ["commit", "-m", "first"], { cwd: repo });
    const firstRef = (
      await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repo })
    ).stdout.trim();
    await writeFileEnsured(join(repo, "version.txt"), "two\n");
    await execFileAsync("git", ["commit", "-am", "second"], { cwd: repo });

    await materializeWorkspaceSource({
      source: { type: "git", url: repo, ref: firstRef },
      taskDir: cwd,
      destination: join(cwd, "git-workspace"),
    });

    await expect(readFile(join(cwd, "git-workspace", "version.txt"), "utf8")).resolves.toBe(
      "one\n",
    );
  });

  it("creates attempt workspace and result directories", async () => {
    const cwd = await createWorkspace();
    const taskDir = join(cwd, "task");
    await writeFileEnsured(join(taskDir, "fixture", "package.json"), "{}\n");

    const directories = await prepareAttemptWorkspace({
      cwd,
      loadedTask: loadedTaskFixture(taskDir),
      runId: "run-1",
      attemptId: "attempt-001",
    });

    expect(directories).toEqual({
      workspaceDir: join(cwd, ".multibench", "workspaces", "run-1", "example-task", "attempt-001"),
      taskResultDir: join(cwd, ".multibench", "results", "run-1", "tasks", "example-task"),
      attemptDir: join(
        cwd,
        ".multibench",
        "results",
        "run-1",
        "tasks",
        "example-task",
        "attempts",
        "attempt-001",
      ),
      harnessArtifactsDir: join(
        cwd,
        ".multibench",
        "results",
        "run-1",
        "tasks",
        "example-task",
        "attempts",
        "attempt-001",
        "harness",
      ),
    });
    await expect(readFile(join(directories.workspaceDir, "package.json"), "utf8")).resolves.toBe(
      "{}\n",
    );
    await expect(
      readFile(join(directories.harnessArtifactsDir, "missing"), "utf8"),
    ).rejects.toThrow();
  });

  it("cleans up attempt workspaces and generates stable attempt ids", async () => {
    const cwd = await createWorkspace();
    const workspaceDir = join(cwd, "workspace");
    await writeFileEnsured(join(workspaceDir, "file.txt"), "temporary\n");

    await cleanupAttemptWorkspace(workspaceDir);

    await expect(readFile(join(workspaceDir, "file.txt"), "utf8")).rejects.toThrow();
    expect(defaultAttemptId(0)).toBe("attempt-001");
    expect(defaultAttemptId(11)).toBe("attempt-012");
  });
});
