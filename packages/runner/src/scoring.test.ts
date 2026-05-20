import { describe, expect, it } from "vitest";
import type { CheckResult } from "@multibench/core";
import { scoreStep, scoreTask } from "./scoring.js";

function check(id: string, status: CheckResult["status"]): CheckResult {
  return {
    id,
    status,
    command: ["sh", "-lc", "true"],
    cwd: "/workspace",
    stdoutPath: `/tmp/${id}.out`,
    stderrPath: `/tmp/${id}.err`,
    durationMs: 1,
  };
}

describe("default scoring", () => {
  it("all checks passed gives full step score", () => {
    expect(
      scoreStep({
        stepId: "step",
        harnessStatus: "completed",
        checks: [check("a", "passed"), check("b", "passed")],
      }),
    ).toMatchObject({
      status: "success",
      score: 2,
      maxScore: 2,
    });
  });

  it("mixed checks gives partial step score", () => {
    expect(
      scoreStep({
        stepId: "step",
        harnessStatus: "completed",
        checks: [check("a", "passed"), check("b", "failed")],
      }),
    ).toMatchObject({
      status: "partial",
      score: 1,
      maxScore: 2,
    });
  });

  it("all checks failed gives failure", () => {
    expect(
      scoreStep({ stepId: "step", harnessStatus: "completed", checks: [check("a", "failed")] }),
    ).toMatchObject({
      status: "failure",
      score: 0,
      maxScore: 1,
    });
  });

  it("harness failure caps step score at failure", () => {
    expect(
      scoreStep({ stepId: "step", harnessStatus: "failed", checks: [check("a", "passed")] }),
    ).toMatchObject({
      status: "failure",
      score: 0,
      maxScore: 1,
    });
  });

  it("task score aggregates step scores and normalizes between 0 and 1", () => {
    const taskScore = scoreTask([
      scoreStep({ stepId: "one", harnessStatus: "completed", checks: [check("a", "passed")] }),
      scoreStep({ stepId: "two", harnessStatus: "completed", checks: [check("b", "failed")] }),
    ]);

    expect(taskScore).toMatchObject({
      status: "partial",
      score: 1,
      maxScore: 2,
      normalizedScore: 0.5,
    });
    expect(taskScore.normalizedScore).toBeGreaterThanOrEqual(0);
    expect(taskScore.normalizedScore).toBeLessThanOrEqual(1);
  });
});
