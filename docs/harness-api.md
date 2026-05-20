# harness api

This document defines the API shape for harness implementations. A harness is the adapter that lets multibench drive a specific coding agent, such as Claude Code, Codex, Aider, OpenHands, or a deterministic mock harness.

The runner owns benchmark orchestration, task-attempt sessions, workspaces, artifacts, checks, scoring, and result aggregation. The harness owns only agent-specific step execution.

## goals

The harness API should support:

- executing one scripted user message against a runner-owned task-attempt session
- preserving native agent context across steps using opaque harness state
- collecting stdout/stderr, structured events, usage, and final status
- stopping native agent work for a runner-owned session when asked
- implementing deterministic mock harnesses for tests

The API should not require every harness to expose the same process model. Some harnesses may run one persistent process. Others, such as Claude Code in non-interactive mode, may run one process per step and resume by native session id.

## package boundary

The public SDK lives in `@multibench/harness`.

```ts
import { defineHarness } from "@multibench/harness";
```

Concrete implementations can live in top-level `harnesses/` while the API is still changing:

```text
harnesses/
  claude-code/
  codex/
  mock/
```

Later, stable implementations can become packages:

```text
packages/harness-claude-code/
packages/harness-codex/
packages/harness-mock/
```

## core model

A benchmark run contains many task attempts. The runner creates one task-attempt session for each attempt. The harness never creates the session; it receives the runner-owned session context on each step.

```text
run
  task attempt session          # runner-owned
    step 1 user message         # harness executes
    step 2 user message         # harness executes with prior harness state
    step 3 user message         # harness executes with prior harness state
```

The runner calls the harness in this order:

1. `runStep(...)` once per scripted user message
2. `stop(...)` after a task attempt, if the harness provides it
3. `shutdown(...)` once after the run, if the harness provides it

## api sketch

```ts
export type Harness = {
  name: string;
  version?: string;
  config?: unknown;

  configure?: (options: unknown) => void | Promise<void>;
  runStep: (input: HarnessRunStepInput) => Promise<HarnessStepOutput>;

  stop?: (input: HarnessStopInput) => Promise<void>;
  shutdown?: () => Promise<void>;
};
```

`defineHarness(...)` should mostly preserve types and validate the returned object:

```ts
export function defineHarness(harness: Harness): Harness {
  return harness;
}
```

There is no separate harness factory in the multibench API. A concrete harness is a `Harness` object. If a harness needs CLI-provided configuration, it may expose `configure(...)`; otherwise configuration can be captured by the harness object itself or read from its environment. The runner only receives the `Harness` object.

## runner-owned session context

The runner creates and persists the task-attempt session. That session has stable paths and an opaque harness state value.

```ts
export type RunnerTaskSession = {
  attemptId: string;
  taskId: string;
  taskTitle: string;
  workspaceDir: string;
  containerWorkspaceDir: string;
  artifactsDir: string;
  containerArtifactsDir: string;
  containerId: string;
  taskDir: string;
  metadata: Record<string, unknown>;

  harnessState?: unknown;
};
```

`workspaceDir`, `containerWorkspaceDir`, `artifactsDir`, `containerArtifactsDir`, and `containerId` are session-level values. They do not change between steps. A task attempt is one continuous runner-owned session over one isolated container and workspace, with one harness artifact root.

The runner owns run-level bookkeeping such as `runId`, `resultsDir`, result aggregation, Docker image/container lifecycle, and the final artifact layout. The harness receives only the task attempt workspace/container context and the harness-specific artifact directory where it may write raw logs or native session data.

Harnesses should execute agent work inside the attempt container. A CLI harness will usually invoke `docker exec` using `containerId` and `containerWorkspaceDir`.

`harnessState` is opaque to the runner. The runner stores it after each step and passes it back to the same harness on the next step. Harnesses use it for native session ids, process handles, SDK continuation tokens, or mock transcript state.

Native state can represent:

- native session id
- `--resume` token
- persistent process handle id
- SDK continuation value
- mock transcript state

For Claude Code, the first step creates or discovers the native Claude session id. Later steps resume that session. This is how multibench evaluates long-context steering rather than isolated one-shot tasks.

## running a step

Each scripted user message is sent through `runStep(...)`.

```ts
export type HarnessRunStepInput = {
  session: RunnerTaskSession;
  step: {
    id: string;
    index: number;
    instruction: string;
    timeoutMs: number;
    attachments?: HarnessAttachment[];
    metadata?: Record<string, unknown>;
  };
};

export type HarnessAttachment =
  | { type: "file"; path: string; description?: string }
  | { type: "image"; path: string; description?: string }
  | { type: "text"; name: string; content: string };
```

Example:

```ts
const output = await harness.runStep({
  session,
  step: {
    id: "add-touch2",
    index: 0,
    instruction: "Add a TOUCH2 command...",
    timeoutMs: 900_000,
  },
});

session.harnessState = output.nextHarnessState;
```

The harness is responsible for preserving native agent context by returning `nextHarnessState` when that state changes. This may mean storing a Claude session id, a persistent process id, or a mock transcript cursor. If `nextHarnessState` is omitted, the runner should keep the prior `session.harnessState`.

## step output

```ts
export type HarnessStepOutput = {
  status: "completed" | "failed" | "timed-out" | "cancelled";

  message?: string;
  error?: {
    name?: string;
    message: string;
    stack?: string;
  };

  events: HarnessEvent[];

  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
  };

  nextHarnessState?: unknown;
  nativeMetadata?: Record<string, unknown>;
};
```

`message` is the final assistant-facing response, if the harness exposes one. The runner should not depend on natural language content for scoring unless a task explicitly asks for a report. Deterministic checks should inspect files, command output, test results, or structured artifacts.

## stopping a session

The runner may ask the harness to stop native work for a runner-owned session.

```ts
export type HarnessStopInput = {
  session: RunnerTaskSession;
  reason: "completed" | "failed" | "timed-out" | "cancelled";
};
```

For CLI-per-step harnesses, `stop(...)` may only write final session metadata. For persistent-process harnesses, it should terminate or detach from the process.

## events

Harnesses should emit structured events as much as practical.

```ts
export type HarnessEvent =
  | { type: "stdout"; time: string; text: string }
  | { type: "stderr"; time: string; text: string }
  | { type: "assistant-message"; time: string; text: string }
  | { type: "tool-call"; time: string; name: string; input?: unknown }
  | { type: "tool-result"; time: string; name: string; output?: unknown }
  | { type: "file-change"; time: string; path: string; action: "created" | "modified" | "deleted" }
  | { type: "usage"; time: string; usage: HarnessStepOutput["usage"] }
  | { type: "native"; time: string; data: unknown };
```

For v0, stdout/stderr plus the final status are enough. Richer events make debugging and reporting much better, but should not block early implementation.

## additional input

Additional user-provided material should go through `attachments` or `metadata`, not by mutating the instruction string in ad hoc ways.

Example:

```ts
await harness.runStep({
  session,
  step: {
    id: "show-log",
    index: 1,
    instruction: "Here is the production log. What does it imply?",
    timeoutMs,
    attachments: [
      { type: "file", path: "evidence/prod.log", description: "Production log excerpt" },
    ],
  },
});
```

Harnesses that cannot pass native attachments should reference the materialized workspace path in the prompt they send to the underlying agent.

## claude code implementation

The Claude Code harness can be implemented in two ways:

1. Preferred: use the Claude Agent SDK from TypeScript.
2. Fallback: shell out to the `claude` CLI in non-interactive print mode.

Both approaches should expose the same multibench harness API.

### configuration

The Claude Code harness can be a configured object:

```ts
export const claudeCodeHarness = defineHarness({
  name: "claude-code",
  version: "...",
  config: {
    model: "claude-sonnet-4-5",
    permissionMode: "bypassPermissions",
  },
  configure(options) {
    this.config = validateClaudeOptions(options);
  },
  async runStep(input) {
    // implementation
  },
});
```

`config` here is harness-specific metadata. The runner may record it for comparability, but it does not interpret it. The CLI may call `configure(...)` with parsed `--harness.*` options before passing the harness to the runner.

### native state

Claude Code uses `nextHarnessState` to preserve the native Claude session id.

```ts
type ClaudeCodeHarnessState = {
  claudeSessionId?: string;
};
```

On step 1, `input.session.harnessState` is empty. The harness starts Claude, captures the native session id, and returns:

```ts
{
  status: "completed",
  events,
  nextHarnessState: {
    claudeSessionId: "..."
  }
}
```

On later steps, the runner passes that value back in `input.session.harnessState`, and the harness resumes the Claude session.

### sdk mode

First step:

```ts
const messages = query({
  prompt: input.step.instruction,
  options: {
    cwd: input.session.containerWorkspaceDir,
    model: config.model,
    maxTurns: config.maxTurns,
    permissionMode: config.permissionMode,
  },
});
```

Later steps:

```ts
const state = input.session.harnessState as ClaudeCodeHarnessState | undefined;

const messages = query({
  prompt: input.step.instruction,
  options: {
    cwd: input.session.containerWorkspaceDir,
    resume: state?.claudeSessionId,
    model: config.model,
    maxTurns: config.maxTurns,
  },
});
```

### cli mode

First step:

```sh
docker exec <container-id> sh -lc '
  cd /workspace &&
  claude -p \
    --output-format stream-json \
    --permission-mode "$PERMISSION_MODE" \
    --max-turns "$MAX_TURNS" \
    "$INSTRUCTION"
'
```

Later steps:

```sh
docker exec <container-id> sh -lc '
  cd /workspace &&
  claude -p \
    --resume "$CLAUDE_SESSION_ID" \
    --output-format stream-json \
    --permission-mode "$PERMISSION_MODE" \
    --max-turns "$MAX_TURNS" \
    "$INSTRUCTION"
'
```

The process working directory must be `input.session.containerWorkspaceDir` inside the attempt container. CLI mode should normally run Claude through `docker exec <container-id> ...`. The harness should parse stream-json events, write the raw stream under `input.session.artifactsDir` on the host or `input.session.containerArtifactsDir` inside the container, and return the next Claude session id in `nextHarnessState`.

## artifacts

The harness writes only inside the runner-provided `session.artifactsDir`.

Recommended harness-local layout:

```text
session.artifactsDir/
  session.json
  steps/
    add-touch2/
      stdout.log
      stderr.log
      events.jsonl
      raw-output.jsonl
      result.json
```

`session.json` should contain native harness metadata:

```json
{
  "harness": "claude-code",
  "nativeSessionId": "...",
  "workspaceDir": "...",
  "containerWorkspaceDir": "/workspace",
  "containerId": "...",
  "startedAt": "...",
  "stoppedAt": "..."
}
```

## mock harness

The mock harness should implement the same API and return scripted outputs. It is required for deterministic tests of the runner.

Example:

```ts
const harness = mockHarness({
  steps: {
    "add-touch2": { status: "completed", message: "done" },
    "add-casmeta": { status: "completed", message: "done" },
    "remove-casmeta": { status: "completed", message: "done" },
  },
});
```

The runner tests should use the mock harness to verify:

- task discovery
- runner-owned session lifecycle
- ordered step execution
- harness state carryover between steps
- artifact writing
- timeout and failure handling
- scoring after each step

## open questions

- Should harnesses support an explicit long-running interrupt API, or is step-level timeout/cancellation enough for v0?
- Should attachments be copied into the workspace by the runner before `runStep(...)`, or should each harness decide how to expose them?
- Should the runner require all harnesses to emit file-change events, or should file diffs be captured independently by the runner after each step?
