import type { CheckDefinition } from "./checks.js";
import type { HarnessAttachment } from "./harness.js";

export type TaskStyle = string;

export type WorkspaceSource =
  | { type: "fixture"; path: string }
  | { type: "git"; url: string; ref: string; submodules?: boolean }
  | { type: "archive"; path: string };

export type DockerEnvironment = {
  dockerfile?: string;
  context?: string;
  image?: string;
  buildArgs?: Record<string, string>;
  env?: Record<string, string>;
  workingDir?: string;
};

export type CheckReference = string | CheckDefinition;

export type TaskStepDefinition = {
  id: string;
  instruction: string;
  checks?: CheckReference[];
  attachments?: HarnessAttachment[];
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
};

export type TaskDefinition = {
  id: string;
  title: string;
  style?: TaskStyle[];
  repo?: WorkspaceSource;
  source?: WorkspaceSource;
  environment: DockerEnvironment;
  instructions: TaskStepDefinition[];
  checks?: CheckDefinition[];
  finalChecks?: CheckDefinition[];
  metadata?: Record<string, unknown>;
};

export type NormalizedStep = {
  id: string;
  index: number;
  instruction: string;
  checks: CheckDefinition[];
  attachments?: HarnessAttachment[];
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
};

export type NormalizedTaskDefinition = {
  id: string;
  title: string;
  style: TaskStyle[];
  source: WorkspaceSource;
  environment: DockerEnvironment;
  instructions: NormalizedStep[];
  checks: CheckDefinition[];
  finalChecks: CheckDefinition[];
  metadata?: Record<string, unknown>;
};
