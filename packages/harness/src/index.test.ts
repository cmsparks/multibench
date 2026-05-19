import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  createMockHarness,
  defineHarness,
  writeHarnessEventsJsonl,
  type Harness,
  type HarnessEvent,
  type HarnessStepOutput,
  type RunnerTaskSession,
} from "./index.js";

function validSession(overrides: Partial<RunnerTaskSession> = {}): RunnerTaskSession {
  return {
    attemptId: "attempt-1",
    taskId: "task-1",
    taskTitle: "Task 1",
    workspaceDir: "/tmp/multibench/workspaces/run-1/task-1/attempt-1",
    containerWorkspaceDir: "/workspace",
    artifactsDir: "/tmp/multibench/results/run-1/task-1/attempt-1/harness",
    containerArtifactsDir: "/artifacts/harness",
    containerId: "container-1",
    taskDir: "/tmp/multibench/tasks/task-1",
    metadata: { runId: "run-1" },
    ...overrides,
  };
}

function completedOutput(overrides: Partial<HarnessStepOutput> = {}): HarnessStepOutput {
  return {
    status: "completed",
    message: "done",
    events: [],
    ...overrides,
  };
}

async function runStepWithRunnerStateCarryover(
  harness: Harness,
  session: RunnerTaskSession,
  stepId: string,
) {
  const output = await harness.runStep({
    session,
    step: {
      id: stepId,
      index: Number(stepId.replace("step-", "")),
      instruction: `Run ${stepId}`,
      timeoutMs: 30_000,
    },
  });

  if (Object.hasOwn(output, "nextHarnessState")) {
    session.harnessState = output.nextHarnessState;
  }

  return output;
}

describe("harness package", () => {
  it("defineHarness returns a valid harness unchanged", () => {
    const harness: Harness = {
      name: "real-harness",
      version: "1.0.0",
      async runStep() {
        return completedOutput();
      },
    };

    expect(defineHarness(harness)).toBe(harness);
  });

  it("invalid harness object fails validation", () => {
    expect(() => defineHarness({ name: "missing-run-step" } as unknown as Harness)).toThrow(
      /runStep/i,
    );
  });

  it("mock harness returns scripted step outputs in order", async () => {
    const harness = createMockHarness({
      steps: [
        completedOutput({
          message: "first response",
          events: [{ type: "stdout", time: "2026-05-19T12:00:00.000Z", text: "first" }],
        }),
        completedOutput({
          status: "failed",
          message: "second response",
          events: [{ type: "stderr", time: "2026-05-19T12:01:00.000Z", text: "second" }],
        }),
      ],
    });

    const session = validSession();
    const first = await runStepWithRunnerStateCarryover(harness, session, "step-0");
    const second = await runStepWithRunnerStateCarryover(harness, session, "step-1");

    expect(first).toMatchObject({ status: "completed", message: "first response" });
    expect(first.events).toEqual([
      { type: "stdout", time: "2026-05-19T12:00:00.000Z", text: "first" },
    ]);
    expect(second).toMatchObject({ status: "failed", message: "second response" });
    expect(second.events).toEqual([
      { type: "stderr", time: "2026-05-19T12:01:00.000Z", text: "second" },
    ]);
  });

  it("mock harness receives the same runner session object across steps", async () => {
    const receivedSessions: RunnerTaskSession[] = [];
    const harness = createMockHarness({
      steps: [
        (input) => {
          receivedSessions.push(input.session);
          input.session.metadata.firstStepSawWorkspace = input.session.workspaceDir;
          return completedOutput();
        },
        (input) => {
          receivedSessions.push(input.session);
          return completedOutput({
            nativeMetadata: { firstStepSawWorkspace: input.session.metadata.firstStepSawWorkspace },
          });
        },
      ],
    });
    const session = validSession();

    await runStepWithRunnerStateCarryover(harness, session, "step-0");
    const second = await runStepWithRunnerStateCarryover(harness, session, "step-1");

    expect(receivedSessions).toHaveLength(2);
    expect(receivedSessions[0]).toBe(session);
    expect(receivedSessions[1]).toBe(session);
    expect(second.nativeMetadata).toEqual({
      firstStepSawWorkspace: "/tmp/multibench/workspaces/run-1/task-1/attempt-1",
    });
  });

  it("mock harness can return nextHarnessState", async () => {
    const harness = createMockHarness({
      steps: [
        completedOutput({
          nextHarnessState: {
            nativeSessionId: "native-1",
            transcriptIndex: 1,
          },
        }),
      ],
    });

    const output = await runStepWithRunnerStateCarryover(harness, validSession(), "step-0");

    expect(output.nextHarnessState).toEqual({
      nativeSessionId: "native-1",
      transcriptIndex: 1,
    });
  });

  it("runner-style state carryover works with mock harness", async () => {
    const harness = createMockHarness({
      steps: [
        (input) =>
          completedOutput({
            message: "created native session",
            nativeMetadata: { priorState: input.session.harnessState },
            nextHarnessState: { nativeSessionId: "native-1", cursor: 1 },
          }),
        (input) =>
          completedOutput({
            message: "kept native session",
            nativeMetadata: { priorState: input.session.harnessState },
          }),
        (input) =>
          completedOutput({
            message: "advanced native session",
            nativeMetadata: { priorState: input.session.harnessState },
            nextHarnessState: { nativeSessionId: "native-1", cursor: 2 },
          }),
      ],
    });
    const session = validSession();

    const first = await runStepWithRunnerStateCarryover(harness, session, "step-0");
    const second = await runStepWithRunnerStateCarryover(harness, session, "step-1");
    const third = await runStepWithRunnerStateCarryover(harness, session, "step-2");

    expect(first.nativeMetadata).toEqual({ priorState: undefined });
    expect(second.nativeMetadata).toEqual({
      priorState: { nativeSessionId: "native-1", cursor: 1 },
    });
    expect(third.nativeMetadata).toEqual({
      priorState: { nativeSessionId: "native-1", cursor: 1 },
    });
    expect(session.harnessState).toEqual({ nativeSessionId: "native-1", cursor: 2 });
  });

  it("event JSONL helper writes valid JSONL", async () => {
    const dir = await mkdtemp(join(tmpdir(), "multibench-harness-"));
    const file = join(dir, "events.jsonl");
    const events: HarnessEvent[] = [
      { type: "stdout", time: "2026-05-19T12:00:00.000Z", text: "installing" },
      {
        type: "tool-call",
        time: "2026-05-19T12:00:01.000Z",
        name: "shell",
        input: { command: "pnpm test" },
      },
      {
        type: "file-change",
        time: "2026-05-19T12:00:02.000Z",
        path: "src/index.ts",
        action: "modified",
      },
    ];

    try {
      await writeHarnessEventsJsonl(file, events);

      const content = await readFile(file, "utf8");
      expect(content.endsWith("\n")).toBe(true);
      expect(content.trimEnd().split("\n").map((line) => JSON.parse(line))).toEqual(events);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
