# master todo

This is the implementation checklist for multibench. It is organized by logically isolated slices so work can proceed in parallel without stepping on the same files.

Design references:

- Package layout: [package-plan.md](./package-plan.md)
- Runner API: [runner-api.md](./runner-api.md)
- Harness API: [harness-api.md](./harness-api.md)
- CLI API: [cli-api.md](./cli-api.md)

## 0. repo scaffold

- [x] Create root `package.json` with workspace configuration.
- [x] Choose package manager and lockfile policy.
- [x] Add root `tsconfig.json`.
- [x] Add shared TypeScript config for packages.
- [x] Add test runner configuration.
- [x] Add lint/format configuration.
- [x] Add `.gitignore` entries for:
  - [x] `node_modules/`
  - [x] `dist/`
  - [x] `.multibench/`
  - [x] coverage output
- [x] Create package directories:
  - [x] `packages/core`
  - [x] `packages/tasks`
  - [x] `packages/harness`
  - [x] `packages/runner`
  - [x] `packages/cli`
- [x] Create top-level content directories:
  - [x] `harnesses/`
  - [x] `tasks/`
  - [x] `test/`
  - [x] `scripts/`
- [x] Add package-level `package.json` files.
- [x] Add package-level `src/index.ts` exports.
- [x] Add initial build command.
- [x] Add initial test command.

Tests:

- [x] Root build succeeds with empty package exports.
- [x] Root test command discovers package tests.
- [x] Package import aliases resolve across workspaces.

## 1. core types and schemas

Owner files:

```text
packages/core/src/
```

Tasks:

- [x] Define status enums:
  - [x] harness step status
  - [x] check status
  - [x] step score status
  - [x] task/attempt/run status
- [x] Define task definition types.
- [x] Define normalized task types.
- [x] Define step/instruction types.
- [x] Define Docker environment types.
- [x] Define workspace source types.
- [x] Define check definition/result types.
- [x] Define scoring types:
  - [x] `ScorePartResult`
  - [x] `StepScore`
  - [x] `TaskScore`
  - [x] suite summary types
- [x] Define result artifact types:
  - [x] `SuiteRunResult`
  - [x] `TaskRunResult`
  - [x] `TaskAttemptResult`
  - [x] `StepRunResult`
- [x] Define `RunnerTaskSession`.
- [x] Define harness event/output types that are shared by runner and harness.
- [x] Add zod schemas for public normalized data.
- [x] Add schema parse helpers with useful error formatting.

Tests:

- [x] Valid normalized task passes schema validation.
- [x] Missing task id fails with useful error.
- [x] Duplicate step id fails with useful error.
- [x] Missing Docker environment fails validation.
- [x] Invalid check command fails validation.
- [x] Result artifact schema accepts a representative completed run.
- [x] Result artifact schema rejects malformed statuses.

## 2. task authoring package

Owner files:

```text
packages/tasks/src/
```

Design reference: [package-plan.md](./package-plan.md)

Tasks:

- [x] Implement `defineTask(...)`.
- [x] Implement `step({ id, checks })\`...\``.
- [x] Use `deindent` inside `step(...)`.
- [x] Trim step text after deindent.
- [x] Reject template interpolation in step text.
- [x] Default omitted checks to `tests/${id}.test.ts`.
- [x] Implement `gitRepo(...)`.
- [x] Implement fixture/archive workspace helpers.
- [x] Implement `dockerEnvironment(...)`.
- [x] Normalize task definitions into core types.
- [x] Validate:
  - [x] task id
  - [x] title
  - [x] Docker environment
  - [x] instruction list
  - [x] unique step ids
  - [x] check references
- [x] Export all task authoring APIs from `@multibench/tasks`.

Tests:

- [x] `step(...)` deindents multiline template text.
- [x] `step(...)` trims leading/trailing blank lines.
- [x] `step(...)` rejects interpolation.
- [x] omitted checks default to `tests/<id>.test.ts`.
- [x] explicit checks are preserved.
- [x] `defineTask(...)` derives instruction count from steps.
- [x] duplicate step ids fail validation.
- [x] task without Docker environment fails validation.
- [x] task with `dockerEnvironment({ dockerfile: "Dockerfile" })` passes.

## 3. harness package

Owner files:

```text
packages/harness/src/
```

Design reference: [harness-api.md](./harness-api.md)

Tasks:

- [x] Define `Harness`.
- [x] Define `HarnessRunStepInput`.
- [x] Define `HarnessStepOutput`.
- [x] Define `HarnessStopInput`.
- [x] Define `HarnessEvent`.
- [x] Define `HarnessAttachment`.
- [x] Implement `defineHarness(...)`.
- [x] Add runtime validation for harness shape.
- [x] Add helper for writing harness events JSONL.
- [x] Add mock harness implementation.
- [x] Add mock harness state carryover support.
- [x] Add utilities for resolving host/container paths if needed.

Tests:

- [x] `defineHarness(...)` returns a valid harness unchanged.
- [x] invalid harness object fails validation.
- [x] mock harness returns scripted step outputs.
- [x] mock harness receives the same runner session object across steps.
- [x] mock harness can return `nextHarnessState`.
- [x] runner-style state carryover works with mock harness.
- [x] event JSONL helper writes valid JSONL.

## 4. runner task discovery and loading

Owner files:

```text
packages/runner/src/discovery*
packages/runner/src/load*
```

Design reference: [runner-api.md](./runner-api.md)

Tasks:

- [x] Implement `discoverTasks(...)`.
- [x] Default pattern to `tasks/**/*.task.ts`.
- [x] Expand directory paths to `**/*.task.ts`.
- [x] Ignore `node_modules`, `dist`, and `.multibench`.
- [x] Implement `.task.ts` import/loading.
- [x] Support default export and reject missing default export.
- [x] Normalize loaded task through `@multibench/tasks`.
- [x] Return `LoadedTask` with:
  - [x] file path
  - [x] task directory
  - [x] normalized definition
- [x] Decide public API names:
  - [x] `loadTask(...)`
  - [x] `runTask(...)`
  - [x] `runSuite(...)`
- [x] Update [runner-api.md](./runner-api.md) once names are final.

Tests:

- [x] no path discovers `tasks/**/*.task.ts`.
- [x] explicit file path loads one task.
- [x] directory path discovers nested task files.
- [x] glob discovers multiple task files.
- [x] ignored directories are ignored.
- [x] missing default export fails clearly.
- [x] invalid task definition fails clearly.
- [x] valid task file normalizes successfully.

## 5. Docker image and container lifecycle

Owner files:

```text
packages/runner/src/docker*
packages/runner/src/workspace*
```

Design reference: [runner-api.md#docker-isolation](./runner-api.md#docker-isolation)

Tasks:

- [x] Implement Docker availability check.
- [x] Implement task image build from task `Dockerfile`.
- [x] Implement task image build from `docker/` context.
- [x] Support prebuilt task image reference if configured.
- [x] Generate deterministic image tags per task file/ref hash.
- [x] Implement image build cache/reuse.
- [x] Materialize workspace source:
  - [x] fixture copy
  - [x] git clone at ref
  - [x] archive extract
- [x] Create attempt workspace under `.multibench/workspaces/<run-id>/<task-id>/<attempt-id>`.
- [x] Create attempt result directory.
- [x] Create harness artifact directory.
- [x] Start one container per attempt.
- [x] Mount or copy workspace to `/workspace`.
- [x] Mount or copy harness artifacts to `/artifacts/harness`.
- [x] Record `containerId`.
- [x] Stop/remove container on success.
- [x] Preserve container on failure when configured.
- [x] Add cleanup command or helper.

Tests:

- [x] image builds from root `Dockerfile`.
- [x] image builds from `docker/` context.
- [x] missing Docker environment fails before run.
- [x] workspace fixture appears at `/workspace` inside container.
- [x] harness artifacts path appears at `/artifacts/harness`.
- [x] container id is recorded in `RunnerTaskSession`.
- [x] container is removed after successful attempt by default.
- [x] failed attempt can preserve container if configured.

## 6. runner execution loop

Owner files:

```text
packages/runner/src/runSuite.ts
packages/runner/src/runTask*.ts
packages/runner/src/session*.ts
```

Design reference: [runner-api.md](./runner-api.md)

Tasks:

- [x] Implement run id generation.
- [x] Implement attempt id generation.
- [x] Create `RunnerTaskSession`.
- [x] Call `harness.runStep({ session, step })` for each step.
- [x] Keep steps serial within an attempt.
- [x] Store `nextHarnessState` only when present.
- [x] Keep prior `harnessState` when omitted.
- [x] Call `harness.stop(...)` at attempt end when present.
- [x] Call `harness.shutdown(...)` at suite end when present.
- [x] Stop attempt on failed/timed-out harness step for v0.
- [x] Ensure cleanup runs in `finally`.
- [x] Support `attempts` per task.
- [x] Support global `concurrency`.
- [x] Ensure each concurrent attempt has isolated workspace/container/artifacts.

Tests:

- [x] one task with three steps calls harness three times in order.
- [x] each step receives same session object.
- [x] `nextHarnessState` from step 1 reaches step 2.
- [x] omitted `nextHarnessState` keeps previous state.
- [x] failed harness step stops remaining steps.
- [x] `harness.stop(...)` is called after completed attempt.
- [x] `harness.stop(...)` is called after failed attempt.
- [x] `harness.shutdown(...)` is called once after suite.
- [x] `attempts: 3` runs three isolated attempts.
- [x] `concurrency: 2` limits concurrent attempts to two.

## 7. checks

Owner files:

```text
packages/runner/src/checks*
```

Design reference: [runner-api.md#checks](./runner-api.md#checks)

Tasks:

- [x] Normalize string check paths to check definitions.
- [x] Run TypeScript validation checks from the host runner, outside the attempt container.
- [x] Run explicit command checks inside Docker.
- [x] Resolve container check `cwd` relative to `/workspace`.
- [x] Resolve host check `cwd` relative to the attempt workspace.
- [x] Expose `MULTIBENCH_WORKSPACE_DIR` to host checks.
- [x] Merge check environment with task/container environment.
- [x] Enforce check timeout.
- [x] Capture stdout/stderr to artifacts.
- [x] Return structured `CheckResult`.
- [x] Handle skipped checks.
- [x] Decide whether failed harness step skips checks in v0.

Tests:

- [x] passing check returns `passed`.
- [x] failing check returns `failed`.
- [x] timed-out check returns `timed-out`.
- [x] stdout/stderr are written to artifact files.
- [x] explicit command checks run inside container, not host.
- [x] TypeScript validation checks run on the host, not inside the container.
- [x] relative `cwd` resolves under `/workspace`.
- [x] host checks can inspect the host attempt workspace.
- [x] env values are visible inside check process.

## 8. diffs and artifacts

Owner files:

```text
packages/runner/src/artifacts*
packages/runner/src/diff*
```

Design reference: [runner-api.md#result-artifacts](./runner-api.md#result-artifacts)

Tasks:

- [x] Create run directory `.multibench/results/<run-id>`.
- [x] Write `run.json`.
- [x] Write `suite-result.json`.
- [x] Write `events.jsonl`.
- [x] Write attempt directories.
- [x] Write exact step input to `steps/<step-id>/input.txt`.
- [x] Write `harness-output.json`.
- [x] Write check results and logs.
- [x] Write `score.json`.
- [x] Capture `diff.patch` after each step.
- [x] Capture final `workspace.patch`.
- [x] Include container metadata in attempt artifacts.
- [x] Include harness config metadata if present.
- [x] Make artifact writes atomic where practical.

Tests:

- [x] run directory layout matches docs.
- [x] every step has `input.txt`.
- [x] every step has `harness-output.json`.
- [x] every check has `result.json`, `stdout.log`, and `stderr.log`.
- [x] diffs are captured after workspace changes.
- [x] suite result JSON validates against core schema.
- [x] attempt result includes `containerId` and container workspace path.

## 9. scoring

Owner files:

```text
packages/core/src/scoring*
packages/runner/src/scoring*
```

Design reference: [runner-api.md#scoring](./runner-api.md#scoring)

Tasks:

- [x] Implement default step scoring:
  - [x] all checks passed -> success
  - [x] some checks passed -> partial
  - [x] no checks passed -> failure
  - [x] harness failed -> failure
- [x] Implement default task scoring from step scores.
- [x] Implement normalized task score.
- [x] Add hooks for future custom scoring rules.
- [x] Add final checks into task score.
- [x] Include score parts in result artifacts.

Tests:

- [x] all checks passed gives full step score.
- [x] mixed checks gives partial step score.
- [x] all checks failed gives failure.
- [x] harness failure caps/fails step score.
- [x] task score aggregates step scores.
- [x] normalized score is between 0 and 1.

## 10. CLI

Owner files:

```text
packages/cli/src/
```

Design reference: [cli-api.md](./cli-api.md)

Tasks:

- [x] Implement `multibench run`.
- [x] Parse positional task globs/paths.
- [x] Default task pattern to `tasks/**/*.task.ts`.
- [x] Parse `--harness <path-to-harness.ts>`.
- [x] Reject non-path harness specs for v0.
- [x] Parse dotted `--harness.<key> <value>` options.
- [x] Support nested dotted keys.
- [x] Support repeated dotted keys as arrays.
- [x] Parse booleans and numeric-looking values conservatively.
- [x] Load `.harness.ts` module.
- [x] Accept default export `Harness`.
- [x] Accept named export `harness`.
- [x] Call `harness.configure(options)` if present.
- [x] Parse `--runs`.
- [x] Parse `--concurrent`.
- [x] Parse `--results-dir`.
- [x] Parse `--run-id`.
- [x] Parse timeout flags.
- [x] Implement `--dry-run`.
- [x] Implement `--list`.
- [x] Implement `multibench list`.
- [x] Implement `multibench validate`.
- [x] Implement `multibench replay`.
- [x] Wire CLI to `runSuite(...)`.

Tests:

- [x] `multibench run` uses default task glob.
- [x] task positional args map to `taskPatterns`.
- [x] `--runs 3` maps to `attempts: 3`.
- [x] `--concurrent 2` maps to `concurrency: 2`.
- [x] `--harness ./x.harness.ts` loads that file.
- [x] non-path harness spec fails.
- [x] `--harness.api_key key` parses into `{ api_key: "key" }`.
- [x] `--harness.model model-string` parses into `{ model: "model-string" }`.
- [x] nested harness option parses correctly.
- [x] repeated harness option becomes array.
- [x] `configure(...)` receives parsed harness options.
- [x] `--dry-run` does not invoke harness.
- [x] `--list` prints matched tasks.

## 11. example/mock harnesses

Owner files:

```text
harnesses/
packages/harness/src/mock*
```

Tasks:

- [x] Add `harnesses/mock/mock.harness.ts`.
- [x] Add mock harness package helper.
- [x] Add `harnesses/claude-code/claude-code.harness.ts` sketch.
- [x] Implement Claude Code option validation:
  - [x] `api_key`
  - [x] `model`
  - [x] `permission_mode`
  - [x] `max_turns`
- [x] Implement Claude Code CLI command construction with `docker exec`.
- [x] Parse Claude stream-json output.
- [x] Store Claude session id in `nextHarnessState`.
- [x] Resume Claude session from `session.harnessState`.
- [x] Write harness-local raw output artifacts.

Tests:

- [x] mock harness works with runner integration tests.
- [x] Claude command construction uses `session.containerId`.
- [x] Claude command construction uses `session.containerWorkspaceDir`.
- [x] Claude step 2 uses prior `claudeSessionId`.
- [x] raw output artifacts are written under `session.artifactsDir`.

## 12. first real task: memcached command rollback

Owner files:

```text
tasks/memcached-command-rollback/
```

Design reference: [README.md](../README.md)

Tasks:

- [x] Create task directory.
- [x] Add `memcached-command-rollback.task.ts`.
- [x] Add Dockerfile.
- [x] Add workspace source for memcached repo/ref.
- [x] Add step 1: add `TOUCH2`.
- [x] Add step 1 checks.
- [x] Add step 2: add `CASMETA`.
- [x] Add step 2 checks.
- [x] Add step 3: remove only `CASMETA`, keep `TOUCH2`.
- [x] Add final checks.
- [x] Add protocol docs expectations.
- [x] Keep validation checks outside the agent-visible workspace.
- [x] Use task-owned TypeScript validation commands.
- [x] Add scoring parts if needed.
- [x] Validate task with CLI.
- [x] Run task with mock harness.

Tests:

- [x] Docker image builds.
- [x] memcached source appears in `/workspace`.
- [x] step 1 check fails on baseline.
- [x] step 1 check passes with known-good solution.
- [x] step 2 check fails without `CASMETA`.
- [x] final check fails if `TOUCH2` removed.
- [x] final check fails if `CASMETA` remains.
- [x] final check passes with known-good final solution.

## 13. integration and end-to-end tests

Owner files:

```text
test/integration/
tasks/
harnesses/
```

Tasks:

- [x] Create tiny Dockerized fixture task for runner tests.
- [x] Create `.task.ts` fixture with two steps.
- [x] Create `.harness.ts` fixture that edits files deterministically.
- [x] Run full CLI against fixture task.
- [x] Verify result artifacts.
- [x] Verify checks execute inside Docker.
- [x] Verify host TypeScript checks execute outside Docker.
- [x] Verify concurrency with multiple fixture tasks.
- [x] Verify replay reads artifacts without invoking harness.

Tests:

- [x] full `multibench run` exits 0 on passing fixture.
- [x] full `multibench run` exits nonzero on failing fixture.
- [x] `multibench validate` catches invalid task.
- [x] `multibench list` prints expected task metadata.
- [x] `multibench replay` prints transcript/checks/scores.

## 14. docs cleanup

Owner files:

```text
README.md
docs/
```

Tasks:

- [x] Update README with final package layout.
- [x] Update README task dictionary as tasks mature.
- [x] Add quickstart.
- [x] Add task authoring guide.
- [x] Add harness authoring guide.
- [x] Add Docker task requirements.
- [x] Add scoring guide.
- [x] Add CLI reference.
- [x] Keep docs consistent with final public API names.

Tests:

- [x] Documentation examples typecheck where practical.
- [x] CLI examples are covered by smoke tests where practical.

## 15. API naming cleanup before implementation lock

Resolved decisions:

- [x] Keep public `loadTask(...)`, `runTask(...)`, and `runSuite(...)`.
- [x] Keep CLI `--runs` mapped to runner `attempts`.
- [x] Keep task workspaces under `.multibench/workspaces`.
- [x] Remove Docker containers by default after attempts.
- [x] Failed checks affect score and suite status; they do not stop the attempt.
- [x] Failed harness steps skip checks in v0.
- [x] Task checks can be arbitrary commands; string paths normalize to TypeScript test commands.

## suggested implementation order

1. Repo scaffold.
2. Core types/schemas.
3. Task authoring package.
4. Harness package with mock harness.
5. Runner discovery/loading.
6. Docker lifecycle.
7. Runner execution loop.
8. Checks.
9. Artifacts.
10. Scoring.
11. CLI.
12. Tiny Dockerized fixture task.
13. End-to-end CLI tests.
14. Memcached task.
15. Claude Code harness.

This order keeps early work testable without depending on real agents. The first end-to-end milestone should use a deterministic mock or file-editing harness inside Docker, not Claude Code.
