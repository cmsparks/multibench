import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RunnerTaskSession } from "@multibench/core";
import { ClaudeCodeHarness, createClaudeCodeHarness } from "./index.js";

const temporaryDirectories: string[] = [];

async function createWorkspace() {
  const directory = await mkdtemp(join(tmpdir(), "multibench-claude-"));
  temporaryDirectories.push(directory);
  return directory;
}

function session(artifactsDir: string, harnessState?: unknown): RunnerTaskSession {
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
    harnessState,
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

describe("ClaudeCodeHarness", () => {
  it("Docker layer installs Claude Code with the native installer", async () => {
    const dockerfile = await readFile(new URL("./Dockerfile", import.meta.url), "utf8");

    expect(dockerfile).toContain("apk add --no-cache bash curl");
    expect(dockerfile).toContain("apt-get install -y --no-install-recommends bash curl");
    expect(dockerfile).toContain("https://claude.ai/install.sh");
    expect(dockerfile).toContain("set -euo pipefail");
    expect(dockerfile).toContain("| bash -s --");
    expect(dockerfile).toContain('ENV PATH="/root/.local/bin:${PATH}"');
    expect(dockerfile).toContain("claude --version");
    expect(dockerfile).not.toContain("npm install");
  });

  it("validates required options through configure", async () => {
    const harness = new ClaudeCodeHarness();

    await expect(harness.configure({ model: "x" })).rejects.toThrow(/api_key/i);
    await expect(
      harness.configure({
        api_key: "key",
        model: "claude-sonnet-4-5",
        max_turns: 80,
        claude_code_version: "1.2.3",
        env: { CLAUDE_CODE_USE_BEDROCK: "1" },
      }),
    ).resolves.toBeUndefined();
    await expect(
      harness.configure({
        api_key: "key",
        model: "claude-sonnet-4-5",
        permission_mode: "default",
      }),
    ).rejects.toThrow(/permission_mode/i);
  });

  it("command construction uses configured Claude Code version and simple env vars", async () => {
    let command = "";
    const harness = new ClaudeCodeHarness({
      execute: async (nextCommand) => {
        command = nextCommand;
        return {
          stdout: JSON.stringify({ type: "system", session_id: "claude-session-1" }) + "\n",
          stderr: "",
          exitCode: 0,
        };
      },
    });
    await harness.configure({
      api_key: "key",
      model: "model",
      claude_code_version: "1.2.3",
      env: { CLAUDE_CODE_SIMPLE_ENV: "matrix-a" },
    });

    await harness.runStep({
      session: session(await createWorkspace()),
      step: { id: "first", index: 0, instruction: "Do it.", timeoutMs: 1000 },
    });

    expect(command).toContain("container-001");
    expect(command).toContain("/workspace");
    expect(command).toContain("ANTHROPIC_API_KEY=key");
    expect(command).toContain("IS_SANDBOX=1");
    expect(command).toContain("CLAUDE_CODE_SIMPLE_ENV=matrix-a");
    expect(command).toContain(" claude --print");
    expect(command).toContain("--output-format stream-json --verbose");
    expect(command).not.toContain("npx");
    expect(command).not.toContain("@anthropic-ai/claude-code@1.2.3");
    expect(command).toContain("--permission-mode bypassPermissions");
  });

  it("exposes a Docker layer built from the task image", async () => {
    const harness = new ClaudeCodeHarness();
    await harness.configure({
      api_key: "key",
      model: "model",
      claude_code_version: "1.2.3",
    });

    expect(harness.dockerImageLayer?.({ baseImage: "multibench-task-example:abc" })).toMatchObject({
      tagPrefix: "multibench-harness-claude-code",
      buildArgs: {
        CLAUDE_CODE_VERSION: "1.2.3",
        MULTIBENCH_TASK_BASE_IMAGE: "multibench-task-example:abc",
      },
    });
  });

  it("step 2 resumes prior Claude session id", async () => {
    let command = "";
    const harness = new ClaudeCodeHarness({
      execute: async (nextCommand) => {
        command = nextCommand;
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    });
    await harness.configure({ api_key: "key", model: "model" });

    await harness.runStep({
      session: session(await createWorkspace(), { claudeSessionId: "claude-session-1" }),
      step: { id: "second", index: 1, instruction: "Continue.", timeoutMs: 1000 },
    });

    expect(command).toContain("--resume claude-session-1");
  });

  it("parses stream-json output and stores session id", async () => {
    const harness = new ClaudeCodeHarness({
      execute: async () => ({
        stdout: [
          JSON.stringify({ type: "system", session_id: "claude-session-1" }),
          JSON.stringify({
            type: "assistant",
            message: { content: [{ type: "text", text: "done" }] },
          }),
          JSON.stringify({ type: "result", subtype: "success" }),
        ].join("\n"),
        stderr: "",
        exitCode: 0,
      }),
    });
    await harness.configure({ api_key: "key", model: "model" });

    const output = await harness.runStep({
      session: session(await createWorkspace()),
      step: { id: "first", index: 0, instruction: "Do it.", timeoutMs: 1000 },
    });

    expect(output).toMatchObject({
      status: "completed",
      nextHarnessState: { claudeSessionId: "claude-session-1" },
    });
    expect(output.events.map((event) => event.type)).toContain("assistant-message");
  });

  it("raw output artifacts are written under session.artifactsDir", async () => {
    const artifactsDir = await createWorkspace();
    const harness = createClaudeCodeHarness({
      execute: async () => ({
        stdout: JSON.stringify({ type: "system", session_id: "claude-session-1" }) + "\n",
        stderr: "",
        exitCode: 0,
      }),
    });
    await harness.configure?.({ api_key: "key", model: "model" });

    await harness.runStep({
      session: session(artifactsDir),
      step: { id: "first", index: 0, instruction: "Do it.", timeoutMs: 1000 },
    });

    await expect(
      readFile(join(artifactsDir, "steps", "first", "raw-output.jsonl"), "utf8"),
    ).resolves.toContain("claude-session-1");
  });
});
