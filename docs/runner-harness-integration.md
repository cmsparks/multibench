# runner and harness integration

This document explains how `@multibench/runner` and `@multibench/harness` fit together.

The short version:

* the runner owns benchmark orchestration, task-attempt sessions, and artifacts
* the harness owns agent-specific step execution
* each task attempt gets one runner-owned session object
* each task step becomes one `harness.runStep(...)` call
* the runner carries opaque harness state from one step to the next

## ownership boundary

### runner owns

* task discovery and loading
* run id and attempt ids
* results directory layout
* workspace creation
* task-attempt session creation
* artifact directory creation
* check execution
* scoring
* aggregation
* lifecycle events for reporters
* timeout policy
* storing opaque harness state between steps

### harness owns

* translating multibench step input into native agent input
* starting, resuming, or continuing the underlying agent as needed for a step
* returning updated native state after a step
* collecting native agent output
* writing harness-local raw logs and native session data
* stopping native work when asked

The harness does not decide which task to run, create task sessions, choose result paths, or compute scores.

## call sequence

```text
CLI
  runSuite(...)
    discoverTasks(...)
    loadTask(...)

    for each task attempt:
      prepare workspace
      create attempt artifacts
      create harness artifacts dir
      create runner task-attempt session

      for each step:
        write runner step input artifact
        harness.runStep({ session, step })
        if output.nextHarnessState is present, update session.harnessState
        write harness output artifact
        capture workspace diff
        run step checks
        score step

      run final checks
      score task attempt
      harness.stop?.({ session, reason: "completed" })

    harness.shutdown?.()
    aggregate suite result
```

## data handoff

The runner creates the session object:

```ts
const session: RunnerTaskSession = {
  attemptId,
  taskId: task.id,
  taskTitle: task.title,
  taskDir: loadedTask.taskDir,
  workspaceDir,
  artifactsDir: harnessArtifactsDir,
  metadata: {
    attemptIndex,
    taskFile: loadedTask.file,
  },
};
```

Then, for each step:

```ts
const output = await harness.runStep({
  session,
  step: {
    id: step.id,
    index: stepIndex,
    instruction: step.instruction,
    timeoutMs: resolvedStepTimeoutMs,
    attachments: step.attachments,
    metadata: {
      checks: step.checks.map((check) => check.id),
    },
  },
});

if ("nextHarnessState" in output) {
  session.harnessState = output.nextHarnessState;
}
```

Important: `workspaceDir` and `artifactsDir` are session-level values created by the runner. They do not appear directly on the step object because they do not change within a task attempt.

## end-to-end example

Given this task:

```ts
export default defineTask({
  id: "memcached-command-rollback",
  title: "Memcached command rollback",
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

The runner does this:

```ts
const session = {
  attemptId: "attempt-1",
  taskId: "memcached-command-rollback",
  taskTitle: "Memcached command rollback",
  taskDir: "/repo/tasks/memcached-command-rollback",
  workspaceDir: "/repo/.multibench/workspaces/run-1/memcached-command-rollback/attempt-1",
  artifactsDir: "/repo/.multibench/results/run-1/tasks/memcached-command-rollback/attempts/attempt-1/harness",
  metadata: {},
};

const firstOutput = await harness.runStep({
  session,
  step: {
    id: "add-touch2",
    index: 0,
    instruction: "Add a TOUCH2 command...",
    timeoutMs: 900_000,
  },
});
if ("nextHarnessState" in firstOutput) session.harnessState = firstOutput.nextHarnessState;

const secondOutput = await harness.runStep({
  session,
  step: {
    id: "add-casmeta",
    index: 1,
    instruction: "Add a CASMETA command...",
    timeoutMs: 900_000,
  },
});
if ("nextHarnessState" in secondOutput) session.harnessState = secondOutput.nextHarnessState;

const thirdOutput = await harness.runStep({
  session,
  step: {
    id: "remove-casmeta",
    index: 2,
    instruction: "Remove only CASMETA. Keep TOUCH2 working and tested.",
    timeoutMs: 900_000,
  },
});
if ("nextHarnessState" in thirdOutput) session.harnessState = thirdOutput.nextHarnessState;

await harness.stop?.({ session, reason: "completed" });
```

The harness maps those calls to the underlying agent. For Claude Code CLI mode, that might mean:

```text
step 1: claude -p "Add a TOUCH2 command..."
        returns nextHarnessState = { claudeSessionId: "..." }

step 2: claude -p --resume <claude-session-id> "Add a CASMETA command..."
        returns nextHarnessState = { claudeSessionId: "..." }

step 3: claude -p --resume <claude-session-id> "Remove only CASMETA..."
        returns nextHarnessState = { claudeSessionId: "..." }
```

The runner does not interpret the native Claude session id. It only stores and returns opaque harness state.

## artifact split

The runner creates the attempt artifact tree:

```text
.multibench/results/<run-id>/tasks/<task-id>/attempts/<attempt-id>/
  attempt.json
  steps/
  harness/
```

The runner writes canonical artifacts:

```text
attempt.json
steps/<step-id>/input.txt
steps/<step-id>/harness-output.json
steps/<step-id>/diff.patch
steps/<step-id>/checks/<check-id>/result.json
steps/<step-id>/score.json
```

The harness writes only inside the harness artifact directory stored on the runner-owned session:

```text
harness/
  session.json
  steps/<step-id>/events.jsonl
  steps/<step-id>/raw-output.jsonl
  steps/<step-id>/result.json
```

The runner may copy or summarize harness outputs into canonical artifacts, but harnesses should not write outside `session.artifactsDir`.

## failure handling

If `harness.runStep(...)` fails or times out:

1. the runner records the step status
2. the runner writes available harness output
3. the runner stores any returned `nextHarnessState`
4. the runner captures the workspace diff if possible
5. the runner runs or skips checks according to policy
6. the runner scores the step
7. for v0, the runner stops the attempt and calls `harness.stop(...)`

Harnesses should return structured failures when possible:

```ts
{
  status: "failed",
  error: {
    name: "ClaudeCodeError",
    message: "Claude process exited with code 1"
  },
  events: [...],
  nextHarnessState: { ... }
}
```

They should throw only for adapter bugs or unrecoverable setup errors. Normal agent failures should become `HarnessStepOutput`.

## timeout handling

The runner owns timeout policy and passes the resolved step timeout into `harness.runStep(...)`.

The harness is responsible for enforcing that timeout against the native agent process or SDK call. If the timeout fires, the harness should cancel or kill the native operation and return:

```ts
{
  status: "timed-out",
  events: [...]
}
```

The runner then applies benchmark policy, usually failing the attempt in v0.

## checks happen after harness steps

Checks are runner-owned and run after `harness.runStep(...)` returns.

```text
harness.runStep(add-touch2)
capture diff
run tests/touch2.test.ts
score add-touch2
```

The harness may run tests as part of its own agent behavior, but those do not count as benchmark checks. Only runner-executed checks are authoritative.

## preserving session context

The integration contract is that one task attempt maps to one runner-owned session object.

The runner preserves this by passing the same session object into every `harness.runStep(...)` call for that attempt.

The harness preserves native agent context by returning `nextHarnessState`, which the runner stores on `session.harnessState` and passes back on the next step. If a step output omits `nextHarnessState`, the runner keeps the previous state.

Native state can represent:

* native session id
* `--resume` token
* persistent process handle id
* SDK continuation value
* mock transcript state

For Claude Code, the first step creates or discovers the native Claude session id. Later steps resume that session. This is how multibench evaluates long-context steering rather than isolated one-shot tasks.

## open design decision

The main remaining question is who copies attachments into the workspace.

Recommended default:

* the runner resolves attachment paths relative to the task directory
* the runner copies attachments into a stable `evidence/` directory inside the workspace
* `harness.runStep(...)` receives the workspace-relative attachment path
* harnesses may add path references to the native agent prompt if the agent lacks attachment support

This keeps attachment handling deterministic and avoids each harness inventing its own file layout.
