import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseSuiteRunResult } from "@multibench/core";
import {
  captureWorkspaceDiff,
  writeAttemptArtifacts,
  writeRunArtifacts,
  writeStepArtifacts,
} from "./artifacts.js";

const temporaryDirectories: string[] = [];

async function createWorkspace() {
  const directory = await mkdtemp(join(tmpdir(), "multibench-artifacts-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  const directories = temporaryDirectories.splice(0);
  await Promise.all(
    directories.map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

describe("runner artifacts", () => {
  it("run directory layout writes run.json, suite-result.json, and events.jsonl", async () => {
    const cwd = await createWorkspace();
    const runDir = join(cwd, ".multibench", "results", "run-artifacts");
    const suite = {
      runId: "run-artifacts",
      runDir,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      status: "completed" as const,
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
    };

    await writeRunArtifacts({
      runDir,
      suiteResult: suite,
      events: [{ type: "native", time: suite.startedAt, data: { ok: true } }],
    });

    expect(JSON.parse(await readFile(join(runDir, "run.json"), "utf8"))).toMatchObject({
      runId: "run-artifacts",
    });
    expect(
      parseSuiteRunResult(JSON.parse(await readFile(join(runDir, "suite-result.json"), "utf8"))),
    ).toMatchObject(suite);
    expect(await readFile(join(runDir, "events.jsonl"), "utf8")).toContain('"type":"native"');
  });

  it("every step has input.txt, harness-output.json, diff.patch, and score.json", async () => {
    const cwd = await createWorkspace();
    const stepDir = join(cwd, "attempt", "steps", "first");

    await writeStepArtifacts({
      stepDir,
      instruction: "Do the first thing.",
      harnessOutput: { status: "completed", events: [] },
      checks: [],
      score: { stepId: "first", status: "success", score: 1, maxScore: 1, parts: [] },
      diff: "diff --git a/file b/file\n",
    });

    await expect(readFile(join(stepDir, "input.txt"), "utf8")).resolves.toBe("Do the first thing.");
    expect(JSON.parse(await readFile(join(stepDir, "harness-output.json"), "utf8"))).toMatchObject({
      status: "completed",
    });
    await expect(readFile(join(stepDir, "diff.patch"), "utf8")).resolves.toContain("diff --git");
    expect(JSON.parse(await readFile(join(stepDir, "score.json"), "utf8"))).toMatchObject({
      status: "success",
    });
  });

  it("every check has result.json, stdout.log, and stderr.log", async () => {
    const cwd = await createWorkspace();
    const stepDir = join(cwd, "attempt", "steps", "first");

    await writeStepArtifacts({
      stepDir,
      instruction: "Do the first thing.",
      harnessOutput: { status: "completed", events: [] },
      checks: [
        {
          id: "check-a",
          status: "passed",
          command: ["sh", "-lc", "true"],
          cwd: "/workspace",
          stdoutPath: join(cwd, "stdout.log"),
          stderrPath: join(cwd, "stderr.log"),
          durationMs: 1,
        },
      ],
      score: { stepId: "first", status: "success", score: 1, maxScore: 1, parts: [] },
      diff: "",
    });

    const checkDir = join(stepDir, "checks", "check-a");
    expect(JSON.parse(await readFile(join(checkDir, "result.json"), "utf8"))).toMatchObject({
      id: "check-a",
    });
    await expect(stat(join(checkDir, "stdout.log"))).resolves.toBeTruthy();
    await expect(stat(join(checkDir, "stderr.log"))).resolves.toBeTruthy();
  });

  it("diffs are captured after workspace changes", async () => {
    const cwd = await createWorkspace();
    const workspaceDir = join(cwd, "workspace");
    await mkdir(workspaceDir, { recursive: true });
    await writeFile(join(workspaceDir, "created.txt"), "created\n", "utf8");

    const diff = await captureWorkspaceDiff(workspaceDir);

    expect(diff).toContain("created.txt");
    expect(diff).toContain("+created");
  });

  it("attempt result includes container metadata", async () => {
    const cwd = await createWorkspace();
    const attemptDir = join(cwd, "attempt");

    await writeAttemptArtifacts({
      attemptDir,
      attempt: {
        attemptId: "attempt-001",
        taskId: "task",
        workspaceDir: join(cwd, "workspace"),
        containerWorkspaceDir: "/workspace",
        containerId: "container-001",
        artifactDir: attemptDir,
        status: "completed",
        steps: [],
        finalChecks: [],
        score: { status: "success", score: 0, maxScore: 0, normalizedScore: 0, stepScores: [] },
      },
    });

    expect(JSON.parse(await readFile(join(attemptDir, "attempt.json"), "utf8"))).toMatchObject({
      containerId: "container-001",
      containerWorkspaceDir: "/workspace",
    });
  });
});
