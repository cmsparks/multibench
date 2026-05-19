# master todo

This is the implementation checklist for multibench. It is organized by logically isolated slices so work can proceed in parallel without stepping on the same files.

Design references:

* Package layout: [package-plan.md](./package-plan.md)
* Runner API: [runner-api.md](./runner-api.md)
* Harness API: [harness-api.md](./harness-api.md)
* CLI API: [cli-api.md](./cli-api.md)

## 0. repo scaffold

- [x] Create root `package.json` with workspace configuration.
- [x] Choose package manager and lockfile policy.
- [x] Add root `tsconfig.json`.
- [x] Add shared TypeScript config for packages.
- [x] Add test runner configuration.
- [ ] Add lint/format configuration.
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

- [ ] Implement `defineTask(...)`.
- [ ] Implement `step({ id, checks })\`...\``.
- [ ] Use `deindent` inside `step(...)`.
- [ ] Trim step text after deindent.
- [ ] Reject template interpolation in step text.
- [ ] Default omitted checks to `tests/${id}.test.ts`.
- [ ] Implement `gitRepo(...)`.
- [ ] Implement fixture/archive workspace helpers.
- [ ] Implement `dockerEnvironment(...)`.
- [ ] Normalize task definitions into core types.
- [ ] Validate:
  - [ ] task id
  - [ ] title
  - [ ] Docker environment
  - [ ] instruction list
  - [ ] unique step ids
  - [ ] check references
- [ ] Export all task authoring APIs from `@multibench/tasks`.

Tests:

- [ ] `step(...)` deindents multiline template text.
- [ ] `step(...)` trims leading/trailing blank lines.
- [ ] `step(...)` rejects interpolation.
- [ ] omitted checks default to `tests/<id>.test.ts`.
- [ ] explicit checks are preserved.
- [ ] `defineTask(...)` derives instruction count from steps.
- [ ] duplicate step ids fail validation.
- [ ] task without Docker environment fails validation.
- [ ] task with `dockerEnvironment({ dockerfile: "Dockerfile" })` passes.

## 3. harness package

Owner files:

```text
packages/harness/src/
```

Design reference: [harness-api.md](./harness-api.md)

Tasks:

- [ ] Define `Harness`.
- [ ] Define `HarnessRunStepInput`.
- [ ] Define `HarnessStepOutput`.
- [ ] Define `HarnessStopInput`.
- [ ] Define `HarnessEvent`.
- [ ] Define `HarnessAttachment`.
- [ ] Implement `defineHarness(...)`.
- [ ] Add runtime validation for harness shape.
- [ ] Add helper for writing harness events JSONL.
- [ ] Add mock harness implementation.
- [ ] Add mock harness state carryover support.
- [ ] Add utilities for resolving host/container paths if needed.

Tests:

- [ ] `defineHarness(...)` returns a valid harness unchanged.
- [ ] invalid harness object fails validation.
- [ ] mock harness returns scripted step outputs.
- [ ] mock harness receives the same runner session object across steps.
- [ ] mock harness can return `nextHarnessState`.
- [ ] runner-style state carryover works with mock harness.
- [ ] event JSONL helper writes valid JSONL.

## 4. runner task discovery and loading

Owner files:

```text
packages/runner/src/discovery*
packages/runner/src/load*
```

Design reference: [runner-api.md](./runner-api.md)

Tasks:

- [ ] Implement `discoverTasks(...)`.
- [ ] Default pattern to `tasks/**/*.task.ts`.
- [ ] Expand directory paths to `**/*.task.ts`.
- [ ] Ignore `node_modules`, `dist`, and `.multibench`.
- [ ] Implement `.task.ts` import/loading.
- [ ] Support default export and reject missing default export.
- [ ] Normalize loaded task through `@multibench/tasks`.
- [ ] Return `LoadedTask` with:
  - [ ] file path
  - [ ] task directory
  - [ ] normalized definition
- [ ] Decide whether public API should expose:
  - [ ] `loadTaskFile(...)`
  - [ ] `runTaskFile(...)`
  - [ ] `runLoadedTask(...)`
  - [ ] `runSuite(...)`
- [ ] Update [runner-api.md](./runner-api.md) once names are final.

Tests:

- [ ] no path discovers `tasks/**/*.task.ts`.
- [ ] explicit file path loads one task.
- [ ] directory path discovers nested task files.
- [ ] glob discovers multiple task files.
- [ ] ignored directories are ignored.
- [ ] missing default export fails clearly.
- [ ] invalid task definition fails clearly.
- [ ] valid task file normalizes successfully.

## 5. Docker image and container lifecycle

Owner files:

```text
packages/runner/src/docker*
packages/runner/src/workspace*
```

Design reference: [runner-api.md#docker-isolation](./runner-api.md#docker-isolation)

Tasks:

- [ ] Implement Docker availability check.
- [ ] Implement task image build from task `Dockerfile`.
- [ ] Implement task image build from `docker/` context.
- [ ] Support prebuilt task image reference if configured.
- [ ] Generate deterministic image tags per task file/ref hash.
- [ ] Implement image build cache/reuse.
- [ ] Materialize workspace source:
  - [ ] fixture copy
  - [ ] git clone at ref
  - [ ] archive extract
- [ ] Create attempt workspace under `.multibench/workspaces/<run-id>/<task-id>/<attempt-id>`.
- [ ] Create attempt result directory.
- [ ] Create harness artifact directory.
- [ ] Start one container per attempt.
- [ ] Mount or copy workspace to `/workspace`.
- [ ] Mount or copy harness artifacts to `/artifacts/harness`.
- [ ] Record `containerId`.
- [ ] Stop/remove container on success.
- [ ] Preserve container on failure when configured.
- [ ] Add cleanup command or helper.

Tests:

- [ ] image builds from root `Dockerfile`.
- [ ] image builds from `docker/` context.
- [ ] missing Docker environment fails before run.
- [ ] workspace fixture appears at `/workspace` inside container.
- [ ] harness artifacts path appears at `/artifacts/harness`.
- [ ] container id is recorded in `RunnerTaskSession`.
- [ ] container is removed after successful attempt by default.
- [ ] failed attempt can preserve container if configured.

## 6. runner execution loop

Owner files:

```text
packages/runner/src/runSuite.ts
packages/runner/src/runTask*.ts
packages/runner/src/session*.ts
```

Design reference: [runner-api.md](./runner-api.md)

Tasks:

- [ ] Implement run id generation.
- [ ] Implement attempt id generation.
- [ ] Create `RunnerTaskSession`.
- [ ] Call `harness.runStep({ session, step })` for each step.
- [ ] Keep steps serial within an attempt.
- [ ] Store `nextHarnessState` only when present.
- [ ] Keep prior `harnessState` when omitted.
- [ ] Call `harness.stop(...)` at attempt end when present.
- [ ] Call `harness.shutdown(...)` at suite end when present.
- [ ] Stop attempt on failed/timed-out harness step for v0.
- [ ] Ensure cleanup runs in `finally`.
- [ ] Support `attempts` per task.
- [ ] Support global `concurrency`.
- [ ] Ensure each concurrent attempt has isolated workspace/container/artifacts.

Tests:

- [ ] one task with three steps calls harness three times in order.
- [ ] each step receives same session object.
- [ ] `nextHarnessState` from step 1 reaches step 2.
- [ ] omitted `nextHarnessState` keeps previous state.
- [ ] failed harness step stops remaining steps.
- [ ] `harness.stop(...)` is called after completed attempt.
- [ ] `harness.stop(...)` is called after failed attempt.
- [ ] `harness.shutdown(...)` is called once after suite.
- [ ] `attempts: 3` runs three isolated attempts.
- [ ] `concurrency: 2` limits concurrent attempts to two.

## 7. checks

Owner files:

```text
packages/runner/src/checks*
```

Design reference: [runner-api.md#checks](./runner-api.md#checks)

Tasks:

- [ ] Normalize string check paths to check definitions.
- [ ] Run TypeScript test checks with the chosen test runner inside Docker.
- [ ] Run explicit command checks inside Docker.
- [ ] Resolve `cwd` relative to `/workspace`.
- [ ] Merge check environment with task/container environment.
- [ ] Enforce check timeout.
- [ ] Capture stdout/stderr to artifacts.
- [ ] Return structured `CheckResult`.
- [ ] Handle skipped checks.
- [ ] Decide whether failed harness step skips checks in v0.

Tests:

- [ ] passing check returns `passed`.
- [ ] failing check returns `failed`.
- [ ] timed-out check returns `timed-out`.
- [ ] stdout/stderr are written to artifact files.
- [ ] check command runs inside container, not host.
- [ ] relative `cwd` resolves under `/workspace`.
- [ ] env values are visible inside check process.

## 8. diffs and artifacts

Owner files:

```text
packages/runner/src/artifacts*
packages/runner/src/diff*
```

Design reference: [runner-api.md#result-artifacts](./runner-api.md#result-artifacts)

Tasks:

- [ ] Create run directory `.multibench/results/<run-id>`.
- [ ] Write `run.json`.
- [ ] Write `suite-result.json`.
- [ ] Write `events.jsonl`.
- [ ] Write attempt directories.
- [ ] Write exact step input to `steps/<step-id>/input.txt`.
- [ ] Write `harness-output.json`.
- [ ] Write check results and logs.
- [ ] Write `score.json`.
- [ ] Capture `diff.patch` after each step.
- [ ] Capture final `workspace.patch`.
- [ ] Include container metadata in attempt artifacts.
- [ ] Include harness config metadata if present.
- [ ] Make artifact writes atomic where practical.

Tests:

- [ ] run directory layout matches docs.
- [ ] every step has `input.txt`.
- [ ] every step has `harness-output.json`.
- [ ] every check has `result.json`, `stdout.log`, and `stderr.log`.
- [ ] diffs are captured after workspace changes.
- [ ] suite result JSON validates against core schema.
- [ ] attempt result includes `containerId` and container workspace path.

## 9. scoring

Owner files:

```text
packages/core/src/scoring*
packages/runner/src/scoring*
```

Design reference: [runner-api.md#scoring](./runner-api.md#scoring)

Tasks:

- [ ] Implement default step scoring:
  - [ ] all checks passed -> success
  - [ ] some checks passed -> partial
  - [ ] no checks passed -> failure
  - [ ] harness failed -> failure
- [ ] Implement default task scoring from step scores.
- [ ] Implement normalized task score.
- [ ] Add hooks for future custom scoring rules.
- [ ] Add final checks into task score.
- [ ] Include score parts in result artifacts.

Tests:

- [ ] all checks passed gives full step score.
- [ ] mixed checks gives partial step score.
- [ ] all checks failed gives failure.
- [ ] harness failure caps/fails step score.
- [ ] task score aggregates step scores.
- [ ] normalized score is between 0 and 1.

## 10. CLI

Owner files:

```text
packages/cli/src/
```

Design reference: [cli-api.md](./cli-api.md)

Tasks:

- [ ] Implement `multibench run`.
- [ ] Parse positional task globs/paths.
- [ ] Default task pattern to `tasks/**/*.task.ts`.
- [ ] Parse `--harness <path-to-harness.ts>`.
- [ ] Reject non-path harness specs for v0.
- [ ] Parse dotted `--harness.<key> <value>` options.
- [ ] Support nested dotted keys.
- [ ] Support repeated dotted keys as arrays.
- [ ] Parse booleans and numeric-looking values conservatively.
- [ ] Load `.harness.ts` module.
- [ ] Accept default export `Harness`.
- [ ] Accept named export `harness`.
- [ ] Call `harness.configure(options)` if present.
- [ ] Parse `--runs`.
- [ ] Parse `--concurrent`.
- [ ] Parse `--results-dir`.
- [ ] Parse `--run-id`.
- [ ] Parse timeout flags.
- [ ] Implement `--dry-run`.
- [ ] Implement `--list`.
- [ ] Implement `multibench list`.
- [ ] Implement `multibench validate`.
- [ ] Implement `multibench replay`.
- [ ] Wire CLI to `runSuite(...)`.

Tests:

- [ ] `multibench run` uses default task glob.
- [ ] task positional args map to `taskPatterns`.
- [ ] `--runs 3` maps to `attempts: 3`.
- [ ] `--concurrent 2` maps to `concurrency: 2`.
- [ ] `--harness ./x.harness.ts` loads that file.
- [ ] non-path harness spec fails.
- [ ] `--harness.api_key key` parses into `{ api_key: "key" }`.
- [ ] `--harness.model model-string` parses into `{ model: "model-string" }`.
- [ ] nested harness option parses correctly.
- [ ] repeated harness option becomes array.
- [ ] `configure(...)` receives parsed harness options.
- [ ] `--dry-run` does not invoke harness.
- [ ] `--list` prints matched tasks.

## 11. example/mock harnesses

Owner files:

```text
harnesses/
packages/harness/src/mock*
```

Tasks:

- [ ] Add `harnesses/mock.harness.ts`.
- [ ] Add mock harness package helper.
- [ ] Add `harnesses/claude-code.harness.ts` sketch.
- [ ] Implement Claude Code option validation:
  - [ ] `api_key`
  - [ ] `model`
  - [ ] `permission_mode`
  - [ ] `max_turns`
- [ ] Implement Claude Code CLI command construction with `docker exec`.
- [ ] Parse Claude stream-json output.
- [ ] Store Claude session id in `nextHarnessState`.
- [ ] Resume Claude session from `session.harnessState`.
- [ ] Write harness-local raw output artifacts.

Tests:

- [ ] mock harness works with runner integration tests.
- [ ] Claude command construction uses `session.containerId`.
- [ ] Claude command construction uses `session.containerWorkspaceDir`.
- [ ] Claude step 2 uses prior `claudeSessionId`.
- [ ] raw output artifacts are written under `session.artifactsDir`.

## 12. first real task: memcached command rollback

Owner files:

```text
tasks/memcached-command-rollback/
```

Design reference: [README.md](../README.md)

Tasks:

- [ ] Create task directory.
- [ ] Add `memcached-command-rollback.task.ts`.
- [ ] Add Dockerfile.
- [ ] Add workspace source for memcached repo/ref.
- [ ] Add step 1: add `TOUCH2`.
- [ ] Add step 1 checks.
- [ ] Add step 2: add `CASMETA`.
- [ ] Add step 2 checks.
- [ ] Add step 3: remove only `CASMETA`, keep `TOUCH2`.
- [ ] Add final checks.
- [ ] Add protocol docs expectations.
- [ ] Add scoring parts if needed.
- [ ] Validate task with CLI.
- [ ] Run task with mock harness.

Tests:

- [ ] Docker image builds.
- [ ] memcached source appears in `/workspace`.
- [ ] step 1 check fails on baseline.
- [ ] step 1 check passes with known-good solution.
- [ ] step 2 check fails without `CASMETA`.
- [ ] final check fails if `TOUCH2` removed.
- [ ] final check fails if `CASMETA` remains.
- [ ] final check passes with known-good final solution.

## 13. integration and end-to-end tests

Owner files:

```text
test/integration/
tasks/
harnesses/
```

Tasks:

- [ ] Create tiny Dockerized fixture task for runner tests.
- [ ] Create `.task.ts` fixture with two steps.
- [ ] Create `.harness.ts` fixture that edits files deterministically.
- [ ] Run full CLI against fixture task.
- [ ] Verify result artifacts.
- [ ] Verify checks execute inside Docker.
- [ ] Verify concurrency with multiple fixture tasks.
- [ ] Verify replay reads artifacts without invoking harness.

Tests:

- [ ] full `multibench run` exits 0 on passing fixture.
- [ ] full `multibench run` exits nonzero on failing fixture.
- [ ] `multibench validate` catches invalid task.
- [ ] `multibench list` prints expected task metadata.
- [ ] `multibench replay` prints transcript/checks/scores.

## 14. docs cleanup

Owner files:

```text
README.md
docs/
```

Tasks:

- [ ] Update README with final package layout.
- [ ] Update README task dictionary as tasks mature.
- [ ] Add quickstart.
- [ ] Add task authoring guide.
- [ ] Add harness authoring guide.
- [ ] Add Docker task requirements.
- [ ] Add scoring guide.
- [ ] Add CLI reference.
- [ ] Keep docs consistent with final public API names.

Tests:

- [ ] Documentation examples typecheck where practical.
- [ ] CLI examples are covered by smoke tests where practical.

## 15. API naming cleanup before implementation lock

Open decisions to resolve before broad implementation:

- [ ] Rename public `loadTask` / `runTask` APIs?
  - [ ] option: `loadTaskFile(...)`
  - [ ] option: `runTaskFile(...)`
  - [ ] option: `runLoadedTask(...)`
  - [ ] keep `runSuite(...)` as the primary CLI-facing API
- [ ] Decide whether CLI `--runs` should remain distinct from runner `attempts`.
- [ ] Decide whether task workspaces live under `.multibench/workspaces` or under each run directory.
- [ ] Decide default Docker cleanup policy.
- [ ] Decide whether failed checks stop the attempt or only affect score.
- [ ] Decide whether failed harness step skips checks in v0.
- [ ] Decide whether task checks are always test files or can be arbitrary commands in v0.

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
