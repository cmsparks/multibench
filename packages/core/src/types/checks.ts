import type { CheckStatus } from "../status.js";

export type CheckDefinition = {
  id: string;
  command: string[];
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  metadata?: Record<string, unknown>;
};

export type CheckResult = {
  id: string;
  status: CheckStatus;
  command: string[];
  cwd: string;
  exitCode?: number;
  stdoutPath: string;
  stderrPath: string;
  durationMs: number;
  metadata?: Record<string, unknown>;
};
