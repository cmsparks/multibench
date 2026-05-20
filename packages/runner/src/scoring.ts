import type { CheckResult, HarnessStepStatus, StepScore, TaskScore } from "@multibench/core";

export type ScoreStepInput = {
  stepId: string;
  harnessStatus: HarnessStepStatus;
  checks: CheckResult[];
};

export function scoreStep(input: ScoreStepInput): StepScore {
  const maxScore = input.checks.length || 1;

  if (input.harnessStatus !== "completed") {
    return {
      stepId: input.stepId,
      status: "failure",
      score: 0,
      maxScore,
      parts: input.checks.map((check) => scorePart(check, 0)),
    };
  }

  if (input.checks.length === 0) {
    return {
      stepId: input.stepId,
      status: "success",
      score: 1,
      maxScore: 1,
      parts: [],
    };
  }

  const parts = input.checks.map((check) => scorePart(check, check.status === "passed" ? 1 : 0));
  const score = parts.reduce((total, part) => total + part.score, 0);

  return {
    stepId: input.stepId,
    status: score === maxScore ? "success" : score > 0 ? "partial" : "failure",
    score,
    maxScore,
    parts,
  };
}

export function scoreTask(stepScores: StepScore[]): TaskScore {
  const score = stepScores.reduce((total, step) => total + step.score, 0);
  const maxScore = stepScores.reduce((total, step) => total + step.maxScore, 0);
  const normalizedScore = maxScore === 0 ? 0 : Math.min(1, Math.max(0, score / maxScore));

  return {
    status: normalizedScore === 1 ? "success" : normalizedScore > 0 ? "partial" : "failure",
    score,
    maxScore,
    normalizedScore,
    stepScores,
  };
}

function scorePart(check: CheckResult, score: number) {
  return {
    id: check.id,
    status: check.status === "passed" ? "success" : "failure",
    score,
    maxScore: 1,
    message: check.status,
    metadata: {
      stdoutPath: check.stdoutPath,
      stderrPath: check.stderrPath,
      exitCode: check.exitCode,
    },
  } as const;
}
