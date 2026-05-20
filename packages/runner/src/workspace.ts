import type { WorkspaceSource } from "@multibench/core";
import { execFile } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { promisify } from "node:util";
import type { LoadedTask } from "./index.js";

const execFileAsync = promisify(execFile);

export type PrepareAttemptWorkspaceOptions = {
  cwd: string;
  loadedTask: LoadedTask;
  runId: string;
  attemptId: string;
  resultsDir?: string;
  workspacesDir?: string;
  env?: NodeJS.ProcessEnv;
};

export type AttemptDirectories = {
  workspaceDir: string;
  attemptDir: string;
  harnessArtifactsDir: string;
  taskResultDir: string;
};

export type MaterializeWorkspaceOptions = {
  source: WorkspaceSource;
  taskDir: string;
  destination: string;
  env?: NodeJS.ProcessEnv;
};

export async function prepareAttemptWorkspace(
  options: PrepareAttemptWorkspaceOptions,
): Promise<AttemptDirectories> {
  const workspacesRoot = resolve(options.cwd, options.workspacesDir ?? ".multibench/workspaces");
  const resultsRoot = resolve(options.cwd, options.resultsDir ?? ".multibench/results");
  const taskId = options.loadedTask.definition.id;
  const workspaceDir = resolve(workspacesRoot, options.runId, taskId, options.attemptId);
  const taskResultDir = resolve(resultsRoot, options.runId, "tasks", taskId);
  const attemptDir = resolve(taskResultDir, "attempts", options.attemptId);
  const harnessArtifactsDir = resolve(attemptDir, "harness");

  await rm(workspaceDir, { recursive: true, force: true });
  await mkdir(dirname(workspaceDir), { recursive: true });
  await materializeWorkspaceSource({
    source: options.loadedTask.definition.source,
    taskDir: options.loadedTask.taskDir,
    destination: workspaceDir,
    env: options.env,
  });
  await mkdir(harnessArtifactsDir, { recursive: true });

  return {
    workspaceDir,
    attemptDir,
    harnessArtifactsDir,
    taskResultDir,
  };
}

export async function materializeWorkspaceSource(
  options: MaterializeWorkspaceOptions,
): Promise<void> {
  await rm(options.destination, { recursive: true, force: true });

  switch (options.source.type) {
    case "fixture": {
      const sourcePath = resolve(options.taskDir, options.source.path);
      await cp(sourcePath, options.destination, {
        recursive: true,
        force: true,
        errorOnExist: false,
        verbatimSymlinks: true,
      });
      return;
    }

    case "git": {
      await mkdir(options.destination, { recursive: true });
      const cloneArgs = ["clone"];
      if (!options.source.submodules) {
        cloneArgs.push("--no-recurse-submodules");
      }
      cloneArgs.push(options.source.url, options.destination);
      await execFileAsync("git", cloneArgs, { env: options.env });
      await execFileAsync("git", ["checkout", options.source.ref], {
        cwd: options.destination,
        env: options.env,
      });
      if (options.source.submodules) {
        await execFileAsync("git", ["submodule", "update", "--init", "--recursive"], {
          cwd: options.destination,
          env: options.env,
        });
      }
      return;
    }

    case "archive": {
      const archivePath = resolve(options.taskDir, options.source.path);
      await mkdir(options.destination, { recursive: true });
      await execFileAsync("tar", ["-xf", archivePath, "-C", options.destination], {
        env: options.env,
      });
      return;
    }
  }
}

export async function createAttemptResultDirectories(
  attemptDir: string,
): Promise<{ attemptDir: string; harnessArtifactsDir: string }> {
  const harnessArtifactsDir = resolve(attemptDir, "harness");
  await mkdir(harnessArtifactsDir, { recursive: true });
  return { attemptDir, harnessArtifactsDir };
}

export async function cleanupAttemptWorkspace(workspaceDir: string): Promise<void> {
  await rm(workspaceDir, { recursive: true, force: true });
}

export function defaultAttemptId(attemptIndex: number): string {
  return `attempt-${String(attemptIndex + 1).padStart(3, "0")}`;
}

export function workspaceSourceLabel(source: WorkspaceSource): string {
  switch (source.type) {
    case "fixture":
      return source.path;
    case "git":
      return `${source.url}#${source.ref}`;
    case "archive":
      return basename(source.path);
  }
}
