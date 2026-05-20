import type { Harness } from "@multibench/harness";
import type {
  AttemptStatus,
  CheckResult,
  HarnessStepStatus,
  RunnerTaskSession,
  StepRunResult,
  TaskAttemptResult,
  TaskRunResult,
  TaskSummary,
} from "@multibench/core";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { LoadedTask } from "./index.js";
import {
  captureWorkspaceDiff,
  writeAttemptArtifacts,
  writeCheckArtifacts,
  writeStepArtifacts,
} from "./artifacts.js";
import { runChecks } from "./checks.js";
import {
  ensureImageLayer,
  ensureTaskImage,
  startAttemptContainer,
  stopAttemptContainer,
} from "./docker.js";
import { scoreStep, scoreTask as scoreTaskResult } from "./scoring.js";
import { defaultAttemptId, prepareAttemptWorkspace } from "./workspace.js";

export type RunnerTimeouts = {
  stepMs?: number;
  checkMs?: number;
  taskMs?: number;
  attemptMs?: number;
  suiteMs?: number;
};

export type RunnerReporter = {
  onTaskStart?: (event: { taskId: string; attemptCount: number }) => void | Promise<void>;
  onAttemptStart?: (event: { taskId: string; attemptId: string }) => void | Promise<void>;
  onAttemptComplete?: (event: { taskId: string; attemptId: string }) => void | Promise<void>;
};

export type RunnerRunContext = {
  cwd: string;
  runId: string;
  runDir: string;
  env: NodeJS.ProcessEnv;
  resultsDir?: string;
};

export type RunTaskOptions = {
  loadedTask: LoadedTask;
  harness: Harness;
  runContext: RunnerRunContext;
  attempts?: number;
  timeouts?: RunnerTimeouts;
  reporter?: RunnerReporter;
  attemptStartIndex?: number;
  skipTaskStartEvent?: boolean;
};

const defaultStepTimeoutMs = 900_000;

export async function runTask(options: RunTaskOptions): Promise<TaskRunResult> {
  const attemptCount = normalizePositiveInteger(options.attempts, "attempts");
  if (!options.skipTaskStartEvent) {
    await options.reporter?.onTaskStart?.({
      taskId: options.loadedTask.definition.id,
      attemptCount,
    });
  }

  const attempts: TaskAttemptResult[] = [];

  for (let attemptOffset = 0; attemptOffset < attemptCount; attemptOffset += 1) {
    attempts.push(await runAttempt(options, attemptOffset));
  }

  return {
    taskId: options.loadedTask.definition.id,
    taskTitle: options.loadedTask.definition.title,
    attempts,
    summary: summarizeTask(attempts),
  };
}

async function runAttempt(
  options: RunTaskOptions,
  attemptOffset: number,
): Promise<TaskAttemptResult> {
  const attemptIndex = (options.attemptStartIndex ?? 0) + attemptOffset;
  const attemptId = defaultAttemptId(attemptIndex);
  const task = options.loadedTask.definition;
  const startedAt = new Date();
  let containerId: string | undefined;
  let stopReason: HarnessStepStatus = "completed";
  let status: AttemptStatus = "completed";
  let session: RunnerTaskSession | undefined;
  const steps: StepRunResult[] = [];
  let finalChecks: CheckResult[] = [];

  await options.reporter?.onAttemptStart?.({ taskId: task.id, attemptId });

  const directories = await prepareAttemptWorkspace({
    cwd: options.runContext.cwd,
    loadedTask: options.loadedTask,
    runId: options.runContext.runId,
    attemptId,
    resultsDir: options.runContext.resultsDir,
    env: options.runContext.env,
  });
  await mkdir(options.runContext.runDir, { recursive: true });

  try {
    const taskImage = await ensureTaskImage({
      loadedTask: options.loadedTask,
      cwd: options.runContext.cwd,
      env: options.runContext.env,
    });
    const harnessLayer = options.harness.dockerImageLayer?.({ baseImage: taskImage.image });
    const image = harnessLayer
      ? await ensureImageLayer({
          layer: harnessLayer,
          baseImage: taskImage.image,
          cwd: options.runContext.cwd,
          env: options.runContext.env,
        })
      : taskImage;
    const container = await startAttemptContainer({
      image: image.image,
      workspaceDir: directories.workspaceDir,
      artifactsDir: directories.harnessArtifactsDir,
      environment: task.environment,
      name: `multibench-${options.runContext.runId}-${task.id}-${attemptId}`.replace(
        /[^a-zA-Z0-9_.-]+/g,
        "-",
      ),
      cwd: options.runContext.cwd,
      env: options.runContext.env,
    });
    containerId = container.containerId;
    session = {
      attemptId,
      taskId: task.id,
      taskTitle: task.title,
      workspaceDir: directories.workspaceDir,
      containerWorkspaceDir: container.containerWorkspaceDir,
      artifactsDir: directories.harnessArtifactsDir,
      containerArtifactsDir: container.containerArtifactsDir,
      containerId: container.containerId,
      taskDir: options.loadedTask.taskDir,
      metadata: {
        attemptIndex,
        taskFile: options.loadedTask.file,
      },
    };

    for (const step of task.instructions) {
      const stepStartedAt = new Date();
      const output = await options.harness.runStep({
        session,
        step: {
          id: step.id,
          index: step.index,
          instruction: step.instruction,
          timeoutMs: step.timeoutMs ?? options.timeouts?.stepMs ?? defaultStepTimeoutMs,
          attachments: step.attachments,
          metadata: {
            ...step.metadata,
            checks: step.checks,
          },
        },
      });
      const stepCompletedAt = new Date();

      if ("nextHarnessState" in output) {
        session.harnessState = output.nextHarnessState;
      }

      const stepDir = join(directories.attemptDir, "steps", step.id);
      const diff = await captureWorkspaceDiff(directories.workspaceDir);
      const checks =
        output.status === "completed"
          ? await runChecks({
              checks: step.checks.map((check) => ({
                ...check,
                timeoutMs: check.timeoutMs ?? options.timeouts?.checkMs,
              })),
              containerId: container.containerId,
              workspaceDir: directories.workspaceDir,
              containerWorkspaceDir: container.containerWorkspaceDir,
              artifactDir: join(stepDir, "checks"),
              env: options.runContext.env,
            })
          : [];
      const score = scoreStep({
        stepId: step.id,
        harnessStatus: output.status,
        checks,
      });
      const stepResult: StepRunResult = {
        stepId: step.id,
        stepIndex: step.index,
        status: output.status,
        harness: output,
        checks,
        score,
        durationMs: stepCompletedAt.getTime() - stepStartedAt.getTime(),
        artifactDir: stepDir,
        diffPath: join(stepDir, "diff.patch"),
        startedAt: stepStartedAt.toISOString(),
        completedAt: stepCompletedAt.toISOString(),
      };
      await writeStepArtifacts({
        stepDir,
        instruction: step.instruction,
        harnessOutput: output,
        checks,
        score,
        diff,
      });
      steps.push(stepResult);

      if (output.status !== "completed") {
        stopReason = output.status;
        status = output.status === "timed-out" ? "timed-out" : "failed";
        break;
      }
    }

    if (status === "completed" && task.finalChecks.length > 0) {
      finalChecks = await runChecks({
        checks: task.finalChecks.map((check) => ({
          ...check,
          timeoutMs: check.timeoutMs ?? options.timeouts?.checkMs,
        })),
        containerId: container.containerId,
        workspaceDir: directories.workspaceDir,
        containerWorkspaceDir: container.containerWorkspaceDir,
        artifactDir: join(directories.attemptDir, "final-checks"),
        env: options.runContext.env,
      });
      await writeCheckArtifacts(join(directories.attemptDir, "final-checks"), finalChecks);
    }
  } catch (error) {
    stopReason = "failed";
    status = "failed";
    if (steps.length === 0) {
      steps.push(failedSetupStep(error));
    }
  } finally {
    if (session) {
      await options.harness.stop?.({ session, reason: stopReason });
    }

    if (containerId) {
      await stopAttemptContainer({
        containerId,
        cwd: options.runContext.cwd,
        env: options.runContext.env,
      });
    }

    await options.reporter?.onAttemptComplete?.({ taskId: task.id, attemptId });
  }

  const completedAt = new Date();
  const scoreInputs = steps.map((step) => step.score);
  if (finalChecks.length > 0) {
    scoreInputs.push(
      scoreStep({
        stepId: "final-checks",
        harnessStatus: "completed",
        checks: finalChecks,
      }),
    );
  }
  const score = scoreTaskResult(scoreInputs);

  const attemptResult = {
    attemptId,
    taskId: task.id,
    workspaceDir: directories.workspaceDir,
    containerWorkspaceDir: session?.containerWorkspaceDir ?? "/workspace",
    containerId: containerId ?? "unavailable",
    artifactDir: directories.attemptDir,
    status,
    steps,
    finalChecks,
    score,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
  };

  await writeAttemptArtifacts({
    attemptDir: directories.attemptDir,
    attempt: attemptResult,
    workspaceDiff: await captureWorkspaceDiff(directories.workspaceDir),
  });

  return attemptResult;
}

function summarizeTask(attempts: TaskAttemptResult[]): TaskSummary {
  const completedAttempts = attempts.filter((attempt) => attempt.status === "completed").length;
  const maxScore = Math.max(0, ...attempts.map((attempt) => attempt.score.maxScore));
  const bestScore = Math.max(0, ...attempts.map((attempt) => attempt.score.score));
  const bestNormalizedScore = Math.max(
    0,
    ...attempts.map((attempt) => attempt.score.normalizedScore),
  );

  return {
    attempts: attempts.length,
    completedAttempts,
    failedAttempts: attempts.length - completedAttempts,
    bestScore,
    maxScore,
    bestNormalizedScore,
  };
}

function failedSetupStep(error: unknown): StepRunResult {
  const now = new Date().toISOString();
  const message = error instanceof Error ? error.message : String(error);
  const stepId = "setup";

  return {
    stepId,
    stepIndex: 0,
    status: "failed",
    harness: {
      status: "failed",
      message,
      error:
        error instanceof Error ? { name: error.name, message, stack: error.stack } : { message },
      events: [],
    },
    checks: [],
    score: scoreStep({ stepId, harnessStatus: "failed", checks: [] }),
    durationMs: 0,
    startedAt: now,
    completedAt: now,
  };
}

function normalizePositiveInteger(value: number | undefined, name: string): number {
  const normalized = value ?? 1;
  if (!Number.isInteger(normalized) || normalized < 1) {
    throw new Error(`${name} must be a positive integer`);
  }

  return normalized;
}
