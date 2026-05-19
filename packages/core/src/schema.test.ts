import { describe, expect, it } from "vitest";
import {
  parseNormalizedTaskDefinition,
  parseSuiteRunResult,
  type NormalizedTaskDefinition,
  type SuiteRunResult,
} from "./index.js";

function validTask(overrides: Partial<NormalizedTaskDefinition> = {}): NormalizedTaskDefinition {
  return {
    id: "example-task",
    title: "Example task",
    style: ["selective-undo"],
    source: { type: "fixture", path: "fixture" },
    environment: { dockerfile: "Dockerfile" },
    instructions: [
      {
        id: "first-step",
        index: 0,
        instruction: "Do the first thing.",
        checks: [{ id: "first-check", command: ["vitest", "run", "tests/first.test.ts"] }],
      },
    ],
    checks: [{ id: "first-check", command: ["vitest", "run", "tests/first.test.ts"] }],
    finalChecks: [],
    ...overrides,
  };
}

function validSuiteResult(overrides: Partial<SuiteRunResult> = {}): SuiteRunResult {
  return {
    runId: "run-1",
    runDir: ".multibench/results/run-1",
    startedAt: "2026-05-19T12:00:00.000Z",
    completedAt: "2026-05-19T12:05:00.000Z",
    status: "completed",
    tasks: [
      {
        taskId: "example-task",
        taskTitle: "Example task",
        attempts: [
          {
            attemptId: "attempt-1",
            taskId: "example-task",
            workspaceDir: ".multibench/workspaces/run-1/example-task/attempt-1",
            containerWorkspaceDir: "/workspace",
            containerId: "container-1",
            artifactDir: ".multibench/results/run-1/tasks/example-task/attempts/attempt-1",
            status: "completed",
            steps: [
              {
                stepId: "first-step",
                stepIndex: 0,
                status: "completed",
                harness: {
                  status: "completed",
                  message: "done",
                  events: [{ type: "stdout", time: "2026-05-19T12:01:00.000Z", text: "ok" }],
                },
                checks: [
                  {
                    id: "first-check",
                    status: "passed",
                    command: ["vitest", "run", "tests/first.test.ts"],
                    cwd: "/workspace",
                    exitCode: 0,
                    stdoutPath: "checks/first-check/stdout.log",
                    stderrPath: "checks/first-check/stderr.log",
                    durationMs: 1000,
                  },
                ],
                score: {
                  stepId: "first-step",
                  status: "success",
                  score: 1,
                  maxScore: 1,
                  parts: [
                    {
                      id: "first-check",
                      status: "success",
                      score: 1,
                      maxScore: 1,
                    },
                  ],
                },
                durationMs: 3000,
              },
            ],
            score: {
              status: "success",
              score: 1,
              maxScore: 1,
              normalizedScore: 1,
              stepScores: [
                {
                  stepId: "first-step",
                  status: "success",
                  score: 1,
                  maxScore: 1,
                  parts: [{ id: "first-check", status: "success", score: 1, maxScore: 1 }],
                },
              ],
            },
          },
        ],
        summary: {
          attempts: 1,
          completedAttempts: 1,
          failedAttempts: 0,
          bestScore: 1,
          maxScore: 1,
          bestNormalizedScore: 1,
        },
      },
    ],
    summary: {
      tasks: 1,
      attempts: 1,
      completedTasks: 1,
      failedTasks: 0,
      score: 1,
      maxScore: 1,
      normalizedScore: 1,
    },
    ...overrides,
  };
}

describe("core schemas", () => {
  it("accepts a valid normalized task", () => {
    expect(parseNormalizedTaskDefinition(validTask()).id).toBe("example-task");
  });

  it("fails with a useful error when task id is missing", () => {
    const task = validTask() as Record<string, unknown>;
    delete task.id;

    expect(() => parseNormalizedTaskDefinition(task)).toThrow(/id/i);
  });

  it("fails with a useful error for duplicate step ids", () => {
    const task = validTask({
      instructions: [
        validTask().instructions[0]!,
        { ...validTask().instructions[0]!, index: 1 },
      ],
    });

    expect(() => parseNormalizedTaskDefinition(task)).toThrow(/duplicate step id "first-step"/i);
  });

  it("fails validation when Docker environment is missing", () => {
    const task = validTask() as Record<string, unknown>;
    delete task.environment;

    expect(() => parseNormalizedTaskDefinition(task)).toThrow(/environment/i);
  });

  it("fails validation when Docker environment has no build or image source", () => {
    expect(() =>
      parseNormalizedTaskDefinition(validTask({ environment: {} })),
    ).toThrow(/docker environment/i);
  });

  it("fails validation for an invalid check command", () => {
    const task = validTask({
      checks: [{ id: "bad-check", command: [] }],
    });

    expect(() => parseNormalizedTaskDefinition(task)).toThrow(/command/i);
  });

  it("accepts a representative completed run result", () => {
    expect(parseSuiteRunResult(validSuiteResult()).status).toBe("completed");
  });

  it("rejects malformed result statuses", () => {
    const result = validSuiteResult() as unknown as Record<string, unknown>;
    result.status = "timed-out";

    expect(() => parseSuiteRunResult(result)).toThrow(/status/i);
  });
});
