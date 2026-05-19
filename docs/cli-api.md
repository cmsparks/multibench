# cli api

This document defines the command-line interface for `@multibench/cli`.

The CLI should behave like a test runner: by default it discovers task files, constructs or loads a harness, then calls `@multibench/runner`.

## command shape

Primary command:

```sh
multibench run [task-glob-or-path ...] [options]
```

Examples:

```sh
multibench run
multibench run tasks/memcached-command-rollback
multibench run "tasks/**/*.task.ts"
multibench run tasks --runs 3 --concurrent 2
multibench run "tasks/**/*.task.ts" --harness ./harnesses/claude-code.harness.ts --harness.model claude-sonnet-4-5 --harness.api_key "$ANTHROPIC_API_KEY"
```

The positional arguments are task globs or paths. If omitted, the CLI should use:

```text
tasks/**/*.task.ts
```

If a positional argument is a directory, the CLI should discover `**/*.task.ts` under that directory.

## run options

```text
multibench run [task-glob-or-path ...]
  --harness <path-to-harness.ts>
  --harness.<key> <value>
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

### `--harness <path-to-harness.ts>`

Selects the harness implementation file. This should be a path to a `.harness.ts` file.

Examples:

```sh
multibench run --harness ./harnesses/claude-code.harness.ts
multibench run --harness ./harnesses/codex.harness.ts
multibench run --harness ../custom/my-agent.harness.ts
```

The loaded module should export a `Harness` object, either as the default export or as a named `harness` export. The CLI should reject non-path harness specs for v0.

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

### `--harness.<key> <value>`

Passes harness-specific options into the loaded harness.

Examples:

```sh
multibench run tasks \
  --harness ./harnesses/claude-code.harness.ts \
  --harness.api_key "$ANTHROPIC_API_KEY" \
  --harness.model claude-sonnet-4-5 \
  --harness.permission_mode bypassPermissions \
  --harness.max_turns 80
```

The CLI should parse dotted harness options into an object:

```ts
{
  api_key: "...",
  model: "claude-sonnet-4-5",
  permission_mode: "bypassPermissions",
  max_turns: 80,
}
```

Values should be parsed conservatively:

* `"true"` and `"false"` become booleans
* numeric-looking values become numbers
* repeated flags become arrays
* everything else remains a string

Nested dotted keys are allowed:

```sh
--harness.env.ANTHROPIC_BASE_URL https://example.test
```

parses to:

```ts
{
  env: {
    ANTHROPIC_BASE_URL: "https://example.test"
  }
}
```

The parsed object should be made available to the harness module before execution. Recommended convention:

```ts
export default defineHarness({
  name: "claude-code",
  async configure(options) {
    // validate and store harness options
  },
  async runStep(input) {
    // use configured options
  },
});
```

`configure(...)` is optional. If present, the CLI calls it once after loading the harness and before calling `runSuite(...)`. The runner still receives only the final `Harness` object.

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

## harness loading

The CLI should load exactly the `.harness.ts` file passed to `--harness`.

Example:

```sh
multibench run tasks \
  --harness ./harnesses/claude-code.harness.ts \
  --harness.api_key "$ANTHROPIC_API_KEY" \
  --harness.model claude-sonnet-4-5
```

The CLI parses:

```ts
{
  taskPatterns: ["tasks"],
  harnessPath: "./harnesses/claude-code.harness.ts",
  harnessOptions: {
    api_key: "...",
    model: "claude-sonnet-4-5",
  },
}
```

Then the CLI loads the harness:

```ts
const harness = await loadHarness({
  path: harnessPath,
  options: harnessOptions,
  cwd,
  env: process.env,
});
```

`loadHarness(...)` is CLI-owned. The runner only receives the resulting `Harness` object.

The loaded module should export a `Harness` object:

```ts
export default defineHarness({
  name: "claude-code",
  async runStep(input) {
    // ...
  },
});
```

If the harness accepts options, it can expose an optional `configure(...)` method on the harness object:

```ts
export default defineHarness({
  name: "claude-code",
  config: {},
  configure(options) {
    this.config = validateClaudeOptions(options);
  },
  async runStep(input) {
    // use this.config
  },
});
```

This keeps options attached to the harness object without adding a separate harness factory.

Recommended module export resolution:

1. if default export is a `Harness`, use it
2. else if named `harness` export is a `Harness`, use it
3. otherwise fail with a clear error

After loading the harness, if `configure(...)` exists, the CLI should call:

```ts
await harness.configure(harnessOptions);
```

Then it passes the configured harness object to the runner.

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
* Should `--concurrent` apply across all attempts globally, or should there also be per-task concurrency limits?
