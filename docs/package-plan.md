# package plan

multibench should be organized as a TypeScript monorepo with small packages and clear dependency direction. The main split is:

* `@multibench/core` - shared types, schemas, scoring primitives, and result formats
* `@multibench/tasks` - task authoring API and task loading
* `@multibench/harness` - harness adapter SDK for custom harness implementations
* `@multibench/runner` - benchmark execution engine
* `@multibench/cli` - command-line interface

## repository structure

```text
packages/
  core/
    src/
      types/
      schema/
      scoring/
      results/

  tasks/
    src/
      defineTask.ts
      step.ts
      repo.ts
      checks.ts
      loadTask.ts

  harness/
    src/
      defineHarness.ts
      types.ts
      workspace.ts
      events.ts
      mock.ts

  runner/
    src/
      runTask.ts
      runSuite.ts
      workspace.ts
      checks.ts
      artifacts.ts

  cli/
    src/
      index.ts
      commands/

harnesses/
  claude-code/
  codex/

tasks/
  memcached-command-rollback/
    memcached-command-rollback.task.ts
    tests/
    fixture/

test/
  unit/
  integration/
  fixtures/

docs/
scripts/
results/        # gitignored
```

## package responsibilities

### `@multibench/core`

Lowest-level shared package. Everything else can depend on this package, but it should not depend on runner, harness, tasks, or CLI code.

Contains:

* task, instruction, harness, run, step, score, and artifact types
* zod schemas for validating normalized definitions and result files
* scoring primitives
* result artifact formats
* common enums and error types

### `@multibench/tasks`

Task authoring and loading package.

Contains:

* `defineTask(...)`
* `step({ id, checks })\`...\``
* repo and fixture helpers, such as `gitRepo(...)`
* check definition helpers
* task normalization and validation

The `step(...)` tagged template should automatically deindent and trim instruction text. Interpolation should be rejected by default so benchmark instructions remain static and auditable.

Example:

```ts
import { defineTask, gitRepo, step } from "@multibench/tasks";

export default defineTask({
  id: "memcached-command-rollback",
  title: "Memcached command rollback",
  style: ["selective-undo", "large-codebase"],
  repo: gitRepo({
    url: "https://github.com/memcached/memcached",
    ref: "...",
  }),
  instructions: [
    step({ id: "add-touch2", checks: ["tests/touch2.test.ts"] })`
      Add a TOUCH2 command that behaves like touch, but returns the remaining TTL.
      Include protocol docs and tests.
    `,
    step({ id: "add-casmeta", checks: ["tests/casmeta.test.ts"] })`
      Add a CASMETA command that exposes CAS and item size metadata.
      Include tests.
    `,
    step({ id: "remove-casmeta", checks: ["tests/final.test.ts"] })`
      Remove only CASMETA. Keep TOUCH2 working and tested.
    `,
  ],
});
```

If `checks` is omitted, it should default to `tests/${id}.test.ts`.

### `@multibench/harness`

SDK for implementing harness adapters.

Contains:

* harness interface
* `defineHarness(...)`
* workspace contract
* event protocol
* process and PTY utilities if shared across harnesses
* mock harness utilities for deterministic tests

The detailed harness lifecycle and Claude Code mapping are documented in [harness-api.md](./harness-api.md).

Concrete harness implementations can start in top-level `harnesses/` while the interface is still changing. Later, stable implementations can move into packages such as:

```text
packages/harness-claude-code/
packages/harness-codex/
packages/harness-mock/
```

### `@multibench/runner`

Execution engine.

Contains:

* loading tasks
* preparing workspaces
* running the instruction loop
* invoking harness adapters
* running step checks and final checks
* scoring
* writing run artifacts
* replay support

The runner should depend on interfaces, not concrete harness implementations.

The detailed runner API is documented in [runner-api.md](./runner-api.md). The runner and harness handoff is documented in [runner-harness-integration.md](./runner-harness-integration.md).

### `@multibench/cli`

Command-line entrypoint. The CLI should work like a test runner: given one or more paths, it discovers matching task files, loads each exported `defineTask(...)`, and runs them.

Contains commands such as:

* `multibench run`
* `multibench list`
* `multibench validate`
* `multibench score`
* `multibench replay`

Default discovery:

```text
**/*.task.ts
```

Example usage:

```sh
multibench run
multibench run tasks/memcached-command-rollback
multibench run "tasks/**/*.task.ts"
multibench validate tasks
```

Task files should default-export a task definition:

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

CLI code should stay thin. Argument parsing and command formatting belong here; benchmark orchestration belongs in `@multibench/runner`.

## dependency direction

```text
core
  ^
  |
tasks      harness
  ^          ^
   \        /
    runner
      ^
      |
     cli
```

Rules:

* `@multibench/core` has no internal package dependencies.
* `@multibench/tasks` depends on `@multibench/core`.
* `@multibench/harness` depends on `@multibench/core`.
* `@multibench/runner` depends on `@multibench/core`, `@multibench/tasks`, and `@multibench/harness`.
* `@multibench/cli` depends on `@multibench/runner` and optionally concrete harness packages.
* No package depends on `@multibench/cli`.

## notes

The top-level `tasks/` directory contains benchmark tasks, not the `@multibench/tasks` package. The package provides the authoring API; the top-level directory contains the actual benchmark content. Benchmark task files should use the `*.task.ts` suffix so the CLI can discover them automatically.

The top-level `test/` directory tests multibench itself. Individual benchmark tasks keep their own task-specific checks under each task directory.
