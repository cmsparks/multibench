import type { HarnessStepStatus } from "../status.js";

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

export type HarnessAttachment =
  | { type: "file"; path: string; description?: string }
  | { type: "image"; path: string; description?: string }
  | { type: "text"; name: string; content: string };

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

export type HarnessStopInput = {
  session: RunnerTaskSession;
  reason: HarnessStepStatus;
};

export type HarnessUsage = {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
};

export type HarnessEvent =
  | { type: "stdout"; time: string; text: string }
  | { type: "stderr"; time: string; text: string }
  | { type: "assistant-message"; time: string; text: string }
  | { type: "tool-call"; time: string; name: string; input?: unknown }
  | { type: "tool-result"; time: string; name: string; output?: unknown }
  | {
      type: "file-change";
      time: string;
      path: string;
      action: "created" | "modified" | "deleted";
    }
  | { type: "usage"; time: string; usage: HarnessUsage }
  | { type: "native"; time: string; data: unknown };

export type HarnessStepOutput = {
  status: HarnessStepStatus;
  message?: string;
  error?: {
    name?: string;
    message: string;
    stack?: string;
  };
  events: HarnessEvent[];
  usage?: HarnessUsage;
  nextHarnessState?: unknown;
  nativeMetadata?: Record<string, unknown>;
};
