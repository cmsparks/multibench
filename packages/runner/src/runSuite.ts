import type { Harness } from "@multibench/harness";
import type {
  SuiteRunResult,
  SuiteSummary,
  TaskAttemptResult,
  TaskRunResult,
} from "@multibench/core";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { discoverTasks, loadTask, type LoadedTask } from "./index.js";
import { writeRunArtifacts } from "./artifacts.js";
import type { RunnerReporter, RunnerTimeouts } from "./runTask.js";
import { runTask } from "./runTask.js";

export type RunSuiteOptions = {
  cwd: string;
  taskPatterns?: string[];
  harness: Harness;
  resultsDir?: string;
  runId?: string;
  attempts?: number;
  concurrency?: number;
  timeouts?: RunnerTimeouts;
  reporter?: RunnerReporter;
  env?: NodeJS.ProcessEnv;
};

export async function runSuite(options: RunSuiteOptions): Promise<SuiteRunResult> {
  const startedAt = new Date();
  const cwd = resolve(options.cwd);
  const runId = options.runId ?? generateRunId();
  const runDir = resolve(cwd, options.resultsDir ?? ".multibench/results", runId);
  const attempts = normalizePositiveInteger(options.attempts, "attempts");
  const concurrency = normalizePositiveInteger(options.concurrency, "concurrency");
  const env = options.env ?? process.env;

  await mkdir(runDir, { recursive: true });

  const discoveredTasks = await discoverTasks({ cwd, patterns: options.taskPatterns });
  const loadedTasks = await Promise.all(
    discoveredTasks.map((task) => loadTask(task.file, { cwd })),
  );

  for (const loadedTask of loadedTasks) {
    await options.reporter?.onTaskStart?.({
      taskId: loadedTask.definition.id,
      attemptCount: attempts,
    });
  }

  const tasksById = new Map<string, { loadedTask: LoadedTask; attempts: TaskAttemptResult[] }>();
  for (const loadedTask of loadedTasks) {
    tasksById.set(loadedTask.definition.id, { loadedTask, attempts: [] });
  }

  const jobs = loadedTasks.flatMap((loadedTask) =>
    Array.from({ length: attempts }, (_, attemptIndex) => ({ loadedTask, attemptIndex })),
  );

  try {
    await runWithConcurrency(jobs, concurrency, async (job) => {
      const taskResult = await runTask({
        loadedTask: job.loadedTask,
        harness: options.harness,
        runContext: {
          cwd,
          runId,
          runDir,
          env,
          resultsDir: options.resultsDir,
        },
        attempts: 1,
        attemptStartIndex: job.attemptIndex,
        timeouts: options.timeouts,
        reporter: options.reporter,
        skipTaskStartEvent: true,
      });

      const taskEntry = tasksById.get(job.loadedTask.definition.id);
      if (!taskEntry) {
        throw new Error(`Missing task result accumulator for ${job.loadedTask.definition.id}`);
      }
      taskEntry.attempts.push(...taskResult.attempts);
    });
  } finally {
    await options.harness.shutdown?.();
  }

  const tasks = [...tasksById.values()].map(({ loadedTask, attempts: taskAttempts }) => {
    const sortedAttempts = taskAttempts.sort((left, right) =>
      left.attemptId.localeCompare(right.attemptId),
    );
    return {
      taskId: loadedTask.definition.id,
      taskTitle: loadedTask.definition.title,
      attempts: sortedAttempts,
      summary: summarizeTask(sortedAttempts),
    };
  });
  const completedAt = new Date();
  const summary = summarizeSuite(tasks);

  const suiteResult = {
    runId,
    runDir,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    status: summary.failedTasks === 0 ? "completed" : "failed",
    tasks,
    summary,
  } satisfies SuiteRunResult;

  await writeRunArtifacts({ runDir, suiteResult });

  return suiteResult;
}

function generateRunId(): string {
  return `run-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      if (item !== undefined) {
        await worker(item);
      }
    }
  });

  await Promise.all(workers);
}

function summarizeTask(attempts: TaskAttemptResult[]): TaskRunResult["summary"] {
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

function summarizeSuite(tasks: TaskRunResult[]): SuiteSummary {
  const taskSummaries = tasks.map((task) => task.summary);
  const attempts = taskSummaries.reduce((total, summary) => total + summary.attempts, 0);
  const score = taskSummaries.reduce((total, summary) => total + summary.bestScore, 0);
  const maxScore = taskSummaries.reduce((total, summary) => total + summary.maxScore, 0);
  const completedTasks = tasks.filter((task) => task.summary.bestNormalizedScore === 1).length;

  return {
    tasks: tasks.length,
    attempts,
    completedTasks,
    failedTasks: tasks.length - completedTasks,
    score,
    maxScore,
    normalizedScore: maxScore === 0 ? 0 : score / maxScore,
  };
}

function normalizePositiveInteger(value: number | undefined, name: string): number {
  const normalized = value ?? 1;
  if (!Number.isInteger(normalized) || normalized < 1) {
    throw new Error(`${name} must be a positive integer`);
  }

  return normalized;
}
