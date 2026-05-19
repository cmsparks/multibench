# runner api

This document defines the API shape for `@multibench/runner`. The runner is the benchmark execution engine. It owns task discovery, workspace preparation, task-attempt session lifecycle, step execution, checks, scoring, and result artifacts.

The CLI should be a thin wrapper around this package.

## responsibilities

The runner owns:

* discovering and loading `*.task.ts` files
* validating normalized task definitions
* creating run ids and attempt ids
* creating the run results directory
* preparing isolated workspaces for task attempts
* creating one runner-owned task-attempt session per attempt
* sending each task step to the harness in order with that session context
* running configured checks after each step
* capturing workspace diffs after each step
* scoring step results and final task results
* writing run, task, step, check, diff, and harness artifacts
* aggregating task results into a suite result

The runner should not implement concrete harness behavior. It only calls the `@multibench/harness` interface.

## public api

The package should expose a small programmatic API:

```ts
export async function discoverTasks(
  options: DiscoverTasksOptions,
): Promise<DiscoveredTask[]>;

export async function loadTask(
  file: string,
  options?: LoadTaskOptions,
): Promise<LoadedTask>;

export async function runTask(
  options: RunTaskOptions,
): Promise<TaskRunResult>;

export async function runSuite(
  options: RunSuiteOptions,
): Promise<SuiteRunResult>;
```

The CLI should primarily call `runSuite(...)`.

## task discovery

Discovery should behave like a test runner. Given no explicit path, it searches for task files under `tasks/`.

```ts
export type DiscoverTasksOptions = {
  cwd: string;
  patterns?: string[];
  ignore?: string[];
};
```

Defaults:

```ts
{
  patterns: ["tasks/**/*.task.ts"],
  ignore: ["**/node_modules/**", "**/dist/**", "**/.multibench/**"],
}
```

Examples:

```ts
await discoverTasks({ cwd: process.cwd() });
await discoverTasks({ cwd, patterns: ["tasks/memcached-command-rollback"] });
await discoverTasks({ cwd, patterns: ["tasks/**/*.task.ts"] });
```

If a path points to a directory, discovery should search for `**/*.task.ts` under that directory.

## task loading

Task loading imports a task file and normalizes the default export.

```ts
export type LoadTaskOptions = {
  cwd: string;
};

export type LoadedTask = {
  file: string;
  taskDir: string;
  definition: NormalizedTaskDefinition;
};
```

Task files should default-export the result of `defineTask(...)`:

```ts
import { defineTask, step } from "@multibench/tasks";

export default defineTask({
  id: "example",
  title: "Example task",
  instructions: [
    step({ id: "first-step" })`
      Do the first thing.
    `,
  ],
});
```

The loader should reject files with no default export, multiple task definitions, duplicate step ids, missing checks, or invalid task metadata.

## suite execution

`runSuite(...)` is the main entrypoint.

```ts
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
```

Defaults:

```ts
{
  resultsDir: ".multibench/results",
  attempts: 1,
  concurrency: 1,
}
```

The runner creates a concrete run artifact directory:

```text
.multibench/results/<run-id>/
```

`runId` may be provided by callers for reproducibility. If omitted, the runner should generate one.

## single task execution

`runTask(...)` runs one loaded task for one or more attempts.

```ts
export type RunTaskOptions = {
  loadedTask: LoadedTask;
  harness: Harness;
  runContext: RunnerRunContext;
  attempts?: number;
  timeouts?: RunnerTimeouts;
  reporter?: RunnerReporter;
};

export type RunnerRunContext = {
  cwd: string;
  runId: string;
  runDir: string;
  env: NodeJS.ProcessEnv;
};
```

The runner owns `runId` and `runDir`. Harnesses do not receive either value directly.

The runner also owns the task-attempt session object passed to the harness:

```ts
export type RunnerTaskSession = {
  attemptId: string;
  taskId: string;
  taskTitle: string;
  workspaceDir: string;
  artifactsDir: string;
  taskDir: string;
  metadata: Record<string, unknown>;
  harnessState?: unknown;
};
```

`harnessState` is opaque to the runner. The runner stores whatever state the harness returns after a step and passes it back on the next step. If a step output omits `nextHarnessState`, the runner keeps the previous state.

## execution flow

For each task attempt, the runner should:

1. Create an `attemptId`.
2. Prepare a clean workspace.
3. Create an attempt artifact directory.
4. Create a harness artifact directory inside the attempt directory.
5. Create a runner-owned task-attempt session object.
6. For each step:
   * write the exact input instruction to artifacts
   * call `harness.runStep(...)` with the session and step instruction
   * collect harness output
   * store `output.nextHarnessState` on the session if provided
   * capture workspace diff
   * run step checks
   * score the step
   * write step artifacts
7. Run final checks if the task defines them separately.
8. Score the task.
9. Call `harness.stop(...)` for the session if provided.
10. Write the attempt result.

The harness artifact directory is stored on the runner-owned session as `artifactsDir`. The harness may write raw logs and native session data there, but the runner still owns the overall results layout.

## workspace preparation

The task definition should describe the source workspace:

```ts
export type WorkspaceSource =
  | { type: "fixture"; path: string }
  | { type: "git"; url: string; ref: string; submodules?: boolean }
  | { type: "archive"; path: string };
```

The runner materializes this into an isolated attempt workspace:

```text
.multibench/workspaces/<run-id>/<task-id>/<attempt-id>/
```

The workspace should be treated as disposable. Checks should run against this workspace. The runner should capture diffs from a clean baseline after every step.

Open question: workspace directories may eventually live under the run directory instead of `.multibench/workspaces`. Keeping them separate can make cleanup easier when result artifacts are archived.

## checks

Checks are deterministic verifications run by the runner, not by the harness.

```ts
export type CheckDefinition = {
  id: string;
  command: string[];
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
};
```

A step may reference one or more checks:

```ts
step({ id: "add-touch2", checks: ["tests/touch2.test.ts"] })`
  Add a TOUCH2 command...
`
```

For TypeScript test checks, the runner can normalize paths into a command such as:

```sh
vitest run tests/touch2.test.ts
```

For non-TypeScript tasks, checks can be explicit commands:

```ts
check({
  id: "memcached-protocol",
  command: ["python", "tests/protocol.py"],
});
```

Each check result should include:

```ts
export type CheckResult = {
  id: string;
  status: "passed" | "failed" | "timed-out" | "skipped";
  command: string[];
  cwd: string;
  exitCode?: number;
  stdoutPath: string;
  stderrPath: string;
  durationMs: number;
};
```

## scoring

The runner should convert check results and explicit scoring rules into structured scores.

```ts
export type StepScore = {
  stepId: string;
  status: "success" | "partial" | "failure";
  score: number;
  maxScore: number;
  parts: ScorePartResult[];
};

export type TaskScore = {
  status: "success" | "partial" | "failure";
  score: number;
  maxScore: number;
  normalizedScore: number;
  stepScores: StepScore[];
};
```

For v0, a simple default is acceptable:

* all checks passed: step success
* some checks passed: step partial
* no checks passed or harness failed: step failure

Tasks can later define richer scoring rules in code.

## result artifacts

The runner should write enough data to debug and compare runs without rerunning them.

Recommended layout:

```text
.multibench/results/<run-id>/
  run.json
  suite-result.json
  events.jsonl
  tasks/
    <task-id>/
      attempts/
        <attempt-id>/
          attempt.json
          workspace.patch
          steps/
            <step-id>/
              input.txt
              harness-output.json
              diff.patch
              checks/
                <check-id>/
                  result.json
                  stdout.log
                  stderr.log
              score.json
          harness/
            session.json
            steps/
              <step-id>/
                events.jsonl
                raw-output.jsonl
                result.json
```

The runner writes the canonical result files. The harness may write inside `harness/`.

## result types

```ts
export type SuiteRunResult = {
  runId: string;
  runDir: string;
  startedAt: string;
  completedAt: string;
  status: "completed" | "failed" | "cancelled";
  tasks: TaskRunResult[];
  summary: SuiteSummary;
};

export type TaskRunResult = {
  taskId: string;
  taskTitle: string;
  attempts: TaskAttemptResult[];
  summary: TaskSummary;
};

export type TaskAttemptResult = {
  attemptId: string;
  taskId: string;
  workspaceDir: string;
  artifactDir: string;
  status: "completed" | "failed" | "timed-out" | "cancelled";
  steps: StepRunResult[];
  score: TaskScore;
};

export type StepRunResult = {
  stepId: string;
  stepIndex: number;
  status: "completed" | "failed" | "timed-out" | "cancelled";
  harness: HarnessStepOutput;
  checks: CheckResult[];
  score: StepScore;
  durationMs: number;
};
```

## reporter api

The runner should expose structured lifecycle events for CLI output and future dashboards.

```ts
export type RunnerReporter = {
  onRunStart?: (event: RunStartEvent) => void | Promise<void>;
  onTaskStart?: (event: TaskStartEvent) => void | Promise<void>;
  onAttemptStart?: (event: AttemptStartEvent) => void | Promise<void>;
  onStepStart?: (event: StepStartEvent) => void | Promise<void>;
  onStepComplete?: (event: StepCompleteEvent) => void | Promise<void>;
  onCheckComplete?: (event: CheckCompleteEvent) => void | Promise<void>;
  onAttemptComplete?: (event: AttemptCompleteEvent) => void | Promise<void>;
  onTaskComplete?: (event: TaskCompleteEvent) => void | Promise<void>;
  onRunComplete?: (event: RunCompleteEvent) => void | Promise<void>;
};
```

The reporter should observe. It should not mutate runner state.

## cancellation and timeouts

Timeouts should be runner-owned:

```ts
export type RunnerTimeouts = {
  stepMs?: number;
  checkMs?: number;
  taskMs?: number;
  suiteMs?: number;
};
```

If a step times out, the runner should call `harness.stop({ session, reason: "timed-out" })` when available, mark the step as timed out, run any configured cleanup, and then decide whether the task can continue. For v0, a timed-out step should fail the attempt and skip remaining steps.

## concurrency

Task attempts can run concurrently, but a single task attempt must run steps serially because the whole point is preserving one session across user messages.

Concurrency rules:

* steps within one attempt: serial
* attempts for the same task: may be parallel if workspaces are isolated
* different tasks: may be parallel if the harness and machine support it

The default should be `concurrency: 1`.

## replay

Replay should use existing artifacts rather than invoking the harness again.

Initial replay support can:

* read `run.json` and `suite-result.json`
* print the step transcript
* show checks and scores
* locate diffs and harness raw output

Later replay support may reconstruct a task attempt workspace at a given step.

## open questions

* Should checks run after every step by default, or only when the step declares checks?
* Should the runner support continuing after a failed step, or should any failed step stop the attempt in v0?
* Should workspace snapshots be full copies, git commits, or patches after each step?
* Should scoring live entirely in `@multibench/core`, or should `@multibench/runner` own the default score derivation from checks?
