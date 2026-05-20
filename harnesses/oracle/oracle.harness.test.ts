import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RunnerTaskSession } from "@multibench/core";
import { createOracleHarness } from "./index.js";

const temporaryDirectories: string[] = [];

async function createTempDir() {
  const directory = await mkdtemp(join(tmpdir(), "multibench-oracle-"));
  temporaryDirectories.push(directory);
  return directory;
}

function session(input: { workspaceDir: string; taskDir: string }): RunnerTaskSession {
  return {
    attemptId: "attempt-001",
    taskId: "task",
    taskTitle: "Task",
    workspaceDir: input.workspaceDir,
    containerWorkspaceDir: "/workspace",
    artifactsDir: join(input.workspaceDir, ".artifacts"),
    containerArtifactsDir: "/artifacts/harness",
    containerId: "container-001",
    taskDir: input.taskDir,
    metadata: {},
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

describe("OracleHarness", () => {
  it("applies the patch for the current step from task solution directory", async () => {
    const root = await createTempDir();
    const workspaceDir = join(root, "workspace");
    const taskDir = join(root, "task");
    await mkdir(join(taskDir, "solution"), { recursive: true });
    await mkdir(workspaceDir, { recursive: true });
    await writeFile(join(workspaceDir, "message.txt"), "before\n", "utf8");
    await writeFile(
      join(taskDir, "solution", "first.patch"),
      [
        "diff --git a/message.txt b/message.txt",
        "index 0000000..0000000 100644",
        "--- a/message.txt",
        "+++ b/message.txt",
        "@@ -1 +1 @@",
        "-before",
        "+after",
        "",
      ].join("\n"),
      "utf8",
    );
    const harness = createOracleHarness();

    await expect(
      harness.runStep({
        session: session({ workspaceDir, taskDir }),
        step: { id: "first", index: 0, instruction: "Do it.", timeoutMs: 1000 },
      }),
    ).resolves.toMatchObject({
      status: "completed",
      events: [expect.objectContaining({ type: "native" })],
    });
    await expect(readFile(join(workspaceDir, "message.txt"), "utf8")).resolves.toBe("after\n");
  });

  it("fails clearly when a step solution patch is missing", async () => {
    const root = await createTempDir();
    const workspaceDir = join(root, "workspace");
    const taskDir = join(root, "task");
    await mkdir(workspaceDir, { recursive: true });
    const harness = createOracleHarness();

    await expect(
      harness.runStep({
        session: session({ workspaceDir, taskDir }),
        step: { id: "missing", index: 0, instruction: "Do it.", timeoutMs: 1000 },
      }),
    ).resolves.toMatchObject({
      status: "failed",
      message: expect.stringContaining("missing.patch"),
    });
  });
});
