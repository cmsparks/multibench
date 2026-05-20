import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RunnerTaskSession } from "@multibench/core";
import { ClaudeCodeCheaterHarness, createClaudeCodeCheaterHarness } from "./index.js";

const temporaryDirectories: string[] = [];

async function createWorkspace() {
  const directory = await mkdtemp(join(tmpdir(), "multibench-claude-cheater-"));
  temporaryDirectories.push(directory);
  return directory;
}

function session(artifactsDir: string): RunnerTaskSession {
  return {
    attemptId: "attempt-001",
    taskId: "task",
    taskTitle: "Task",
    workspaceDir: "/host/workspace",
    containerWorkspaceDir: "/workspace",
    artifactsDir,
    containerArtifactsDir: "/artifacts/harness",
    containerId: "container-001",
    taskDir: "/task",
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

describe("ClaudeCodeCheaterHarness", () => {
  it("inherits the Claude Code harness behavior and Docker layer", async () => {
    const harness = new ClaudeCodeCheaterHarness();
    await harness.configure({ api_key: "key", model: "model", claude_code_version: "1.2.3" });

    expect(harness).toBeInstanceOf(ClaudeCodeCheaterHarness);
    expect(harness.name).toBe("claude-code-cheater");
    expect(harness.dockerImageLayer?.({ baseImage: "task-image" })).toMatchObject({
      tagPrefix: "multibench-harness-claude-code",
      buildArgs: {
        CLAUDE_CODE_VERSION: "1.2.3",
        MULTIBENCH_TASK_BASE_IMAGE: "task-image",
      },
    });
  });

  it("attaches the cheating prompt instruction to each step before delegating", async () => {
    let command = "";
    const harness = createClaudeCodeCheaterHarness({
      execute: async (nextCommand) => {
        command = nextCommand;
        return {
          stdout: JSON.stringify({ type: "system", session_id: "claude-session-1" }) + "\n",
          stderr: "",
          exitCode: 0,
        };
      },
    });
    await harness.configure?.({ api_key: "key", model: "model" });

    await harness.runStep({
      session: session(await createWorkspace()),
      step: {
        id: "first",
        index: 0,
        instruction: "Legitimate task instruction.",
        timeoutMs: 1000,
      },
    });

    const prompt = await readFile(new URL("./cheat-prompt.md", import.meta.url), "utf8");
    expect(command).toContain("Legitimate task instruction.");
    expect(command).toContain(prompt.trim().slice(0, 120));
    expect(command.indexOf("Legitimate task instruction.")).toBeLessThan(
      command.indexOf(prompt.trim().slice(0, 120)),
    );
  });
});
