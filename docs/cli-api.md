# cli api

This document defines the command-line interface for `@multibench/cli`.

The CLI should behave like a test runner: by default it discovers task files, constructs or loads a harness, then calls `@multibench/runner`.

## command shape

Primary command:

```sh
multibench run [task-glob-or-path ...] [options] [-- harness-options...]
```

Examples:

```sh
multibench run
multibench run tasks/memcached-command-rollback
multibench run "tasks/**/*.task.ts"
multibench run tasks --runs 3 --concurrent 2
multibench run "tasks/**/*.task.ts" --harness claude-code -- --model claude-sonnet-4-5 --permission-mode bypassPermissions
```

The positional arguments are task globs or paths. If omitted, the CLI should use:

```text
tasks/**/*.task.ts
```

If a positional argument is a directory, the CLI should discover `**/*.task.ts` under that directory.

## run options

```text
multibench run [task-glob-or-path ...]
  --harness <name-or-module>
  --runs <n>
  --concurrent <n>
  --results-dir <path>
  --run-id <id>
  --timeout-step <duration>
  --timeout-check <duration>
  --timeout-task <duration>
  --timeout-suite <duration>
  --reporter <name>
  --dry-run
  --list
  --help
  -- harness-options...
```

Recommended aliases:

```text
--runs, -r
--concurrent, -j
--harness, -h is not recommended because -h is usually help
```

Avoid `-h` for harness. Reserve it for help.

## option meanings

### `task-glob-or-path`

One or more task selectors.

Examples:

```sh
multibench run tasks
multibench run tasks/memcached-command-rollback
multibench run "tasks/**/*.task.ts"
multibench run tasks/a.task.ts tasks/b.task.ts
```

These map to `RunSuiteOptions.taskPatterns`.

### `--harness <name-or-module>`

Selects the harness implementation.

Examples:

```sh
multibench run --harness claude-code
multibench run --harness codex
multibench run --harness ./harnesses/my-harness.ts
multibench run --harness @company/multibench-harness
```

The loaded module should export a `Harness` object, either as the default export or as a named `harness` export.

Example:

```ts
import { defineHarness } from "@multibench/harness";

export default defineHarness({
  name: "custom",
  async runStep(input) {
    // ...
  },
});
```

The CLI should not require a separate harness factory. It loads a harness object and passes it to `runSuite(...)`.

### `--runs <n>`

Number of attempts per task.

Example:

```sh
multibench run tasks --runs 5
```

This maps to `RunSuiteOptions.attempts`.

Naming note: the runner API currently calls this `attempts`; the CLI should expose `--runs` because it is clearer from a user perspective. Internally, `runs` and `attempts` mean the same thing: independent attempts per task.

### `--concurrent <n>`

Maximum number of task attempts running at once.

Example:

```sh
multibench run tasks --runs 3 --concurrent 2
```

This maps to `RunSuiteOptions.concurrency`.

Steps inside a single attempt are always serial. Concurrency only applies across task attempts.

### `--results-dir <path>`

Overrides the base results directory.

Default:

```text
.multibench/results
```

### `--run-id <id>`

Uses a caller-provided run id. Useful for reproducibility and CI.

If omitted, the runner generates one.

### timeout options

Timeout options should accept human-readable durations:

```sh
multibench run --timeout-step 15m --timeout-check 2m --timeout-task 1h --timeout-suite 6h
```

These map to:

```ts
{
  timeouts: {
    stepMs,
    checkMs,
    taskMs,
    suiteMs,
  }
}
```

### `--dry-run`

Discovers and validates tasks, resolves the harness, prints what would run, and exits without invoking the harness.

### `--list`

Lists matched tasks and exits.

This is equivalent to a lightweight `multibench list` mode.

## arbitrary harness options

Harness options should be passed after `--`. The CLI should collect these tokens without interpreting them and pass them to the selected harness loader.

Example:

```sh
multibench run tasks \
  --harness claude-code \
  --runs 3 \
  --concurrent 2 \
  -- \
  --model claude-sonnet-4-5 \
  --permission-mode bypassPermissions \
  --max-turns 80
```

The CLI parses:

```ts
{
  taskPatterns: ["tasks"],
  harness: "claude-code",
  runs: 3,
  concurrent: 2,
  harnessArgs: [
    "--model", "claude-sonnet-4-5",
    "--permission-mode", "bypassPermissions",
    "--max-turns", "80",
  ],
}
```

Then the CLI loads the harness:

```ts
const harness = await loadHarness({
  spec: "claude-code",
  args: harnessArgs,
  cwd,
  env: process.env,
});
```

`loadHarness(...)` is CLI-owned. The runner only receives the resulting `Harness` object.

## harness loading

The CLI should support built-in names and module paths.

Resolution order:

1. built-in harness alias, such as `claude-code`
2. relative or absolute module path
3. package import specifier

Built-in aliases can map to local modules:

```ts
const builtinHarnesses = {
  "claude-code": "@multibench/harness-claude-code",
  codex: "@multibench/harness-codex",
  mock: "@multibench/harness-mock",
};
```

Harness modules can optionally export a CLI argument parser:

```ts
export function parseHarnessArgs(args: string[]): unknown {
  return {
    model: getArg(args, "--model"),
    permissionMode: getArg(args, "--permission-mode"),
  };
}

export function createHarness(config: unknown): Harness {
  return defineHarness({
    name: "claude-code",
    config,
    async runStep(input) {
      // ...
    },
  });
}
```

This factory is a CLI loading convention, not part of the runner/harness interface. From the runner's perspective, the final value is still just a `Harness`.

For the simplest case, a module may export the harness directly:

```ts
export default defineHarness({
  name: "mock",
  async runStep(input) {
    // ...
  },
});
```

Recommended module export resolution:

1. if default export is a `Harness`, use it
2. else if named `harness` export is a `Harness`, use it
3. else if named `createHarness` export exists, call it with parsed harness config
4. otherwise fail with a clear error

## mapping to runner options

CLI options should map into `runSuite(...)` like this:

```ts
await runSuite({
  cwd,
  taskPatterns,
  harness,
  resultsDir,
  runId,
  attempts: runs,
  concurrency: concurrent,
  timeouts,
  reporter,
  env: process.env,
});
```

## other commands

### `multibench list`

```sh
multibench list [task-glob-or-path ...]
```

Discovers task files, loads task metadata, and prints task id, title, instruction count, and path.

### `multibench validate`

```sh
multibench validate [task-glob-or-path ...]
```

Loads task files and validates definitions without running the harness.

### `multibench replay`

```sh
multibench replay <run-id-or-run-dir>
```

Reads existing result artifacts and prints transcript, checks, scores, and artifact paths.

## open questions

* Should `--runs` be renamed to `--attempts` for API consistency, or is `--runs` better for users?
* Should harness args be only raw passthrough after `--`, or should built-in harnesses also expose typed top-level flags?
* Should `--concurrent` apply across all attempts globally, or should there also be per-task concurrency limits?
