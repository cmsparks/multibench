import type { CheckDefinition, CheckReference, CheckResult } from "@multibench/core";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, posix, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const defaultCheckTimeoutMs = 120_000;

export type RunChecksOptions = {
  checks: CheckReference[];
  containerId: string;
  workspaceDir?: string;
  containerWorkspaceDir: string;
  artifactDir: string;
  dockerPath?: string;
  env?: NodeJS.ProcessEnv;
  skip?: boolean;
};

export async function runChecks(options: RunChecksOptions): Promise<CheckResult[]> {
  const checks = normalizeChecks(options.checks);
  const results: CheckResult[] = [];

  for (const check of checks) {
    results.push(await runCheck(check, options));
  }

  return results;
}

runChecks.normalize = normalizeChecks;

async function runCheck(check: CheckDefinition, options: RunChecksOptions): Promise<CheckResult> {
  const checkDir = resolve(options.artifactDir, check.id);
  const stdoutPath = resolve(checkDir, "stdout.log");
  const stderrPath = resolve(checkDir, "stderr.log");
  const runsOnHost = isHostCheck(check);
  const cwd = runsOnHost
    ? resolveHostCwd(options.workspaceDir, check.cwd)
    : resolveContainerCwd(options.containerWorkspaceDir, check.cwd);
  const startedAt = Date.now();

  await mkdir(checkDir, { recursive: true });

  if (options.skip) {
    await writeFile(stdoutPath, "", "utf8");
    await writeFile(stderrPath, "", "utf8");
    return {
      id: check.id,
      status: "skipped",
      command: check.command,
      cwd,
      exitCode: undefined,
      stdoutPath,
      stderrPath,
      durationMs: Date.now() - startedAt,
      metadata: check.metadata,
    };
  }

  const hostCommand = resolveCommand(check.command);
  const args = runsOnHost ? hostCommand.args : ["exec", "-w", cwd];
  if (!runsOnHost) {
    for (const [key, value] of Object.entries(check.env ?? {})) {
      args.push("-e", `${key}=${value}`);
    }
    args.push(options.containerId);
    args.push(...check.command);
  }

  try {
    const result = await execFileAsync(runsOnHost ? hostCommand.executable : (options.dockerPath ?? "docker"), args, {
      cwd: runsOnHost ? cwd : undefined,
      env: runsOnHost
        ? {
            ...options.env,
            ...check.env,
            MULTIBENCH_WORKSPACE_DIR: options.workspaceDir,
            MULTIBENCH_CONTAINER_WORKSPACE_DIR: options.containerWorkspaceDir,
            MULTIBENCH_CONTAINER_ID: options.containerId,
          }
        : options.env,
      timeout: check.timeoutMs ?? defaultCheckTimeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
    await writeFile(stdoutPath, result.stdout, "utf8");
    await writeFile(stderrPath, result.stderr, "utf8");
    return {
      id: check.id,
      status: "passed",
      command: check.command,
      cwd,
      exitCode: 0,
      stdoutPath,
      stderrPath,
      durationMs: Date.now() - startedAt,
      metadata: check.metadata,
    };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string | null;
      killed?: boolean;
      signal?: string | null;
    };
    await writeFile(stdoutPath, nodeError.stdout ?? "", "utf8");
    await writeFile(stderrPath, nodeError.stderr ?? "", "utf8");

    return {
      id: check.id,
      status: nodeError.killed || nodeError.signal === "SIGTERM" ? "timed-out" : "failed",
      command: check.command,
      cwd,
      exitCode: typeof nodeError.code === "number" ? nodeError.code : undefined,
      stdoutPath,
      stderrPath,
      durationMs: Date.now() - startedAt,
      metadata: check.metadata,
    };
  }
}

function normalizeChecks(checks: CheckReference[], defaultId?: string): CheckDefinition[] {
  return checks.map((check, index) => {
    if (typeof check === "string") {
      return {
        id: defaultId ?? inferCheckId(check, index),
        command: ["tsx", check],
        metadata: { runner: "host" },
      };
    }

    return check;
  });
}

function isHostCheck(check: CheckDefinition): boolean {
  return (
    check.metadata?.runner === "host" ||
    (check.command.length >= 2 && check.command[0] === "tsx" && check.command[1]!.endsWith(".ts"))
  );
}

function resolveCommand(command: string[]): { executable: string; args: string[] } {
  if (command[0] === "tsx") {
    return {
      executable: process.execPath,
      args: command.slice(1),
    };
  }

  return {
    executable: command[0]!,
    args: command.slice(1),
  };
}

function resolveHostCwd(workspaceDir: string | undefined, cwd?: string): string {
  const hostWorkspaceDir = workspaceDir ?? process.cwd();
  if (!cwd) {
    return hostWorkspaceDir;
  }
  if (isAbsolute(cwd)) {
    return cwd;
  }
  return resolve(hostWorkspaceDir, cwd);
}

function inferCheckId(path: string, index: number): string {
  const basename = path
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.test\.[^.]+$/, "")
    .replace(/\.[^.]+$/, "");
  return basename && basename !== "test" ? basename : `check-${index + 1}`;
}

function resolveContainerCwd(containerWorkspaceDir: string, cwd?: string): string {
  if (!cwd) {
    return containerWorkspaceDir;
  }

  if (cwd.startsWith("/")) {
    return posix.normalize(cwd);
  }

  return posix.join(containerWorkspaceDir, cwd);
}
