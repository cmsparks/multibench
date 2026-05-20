import type {
  CheckResult,
  HarnessEvent,
  HarnessStepOutput,
  StepScore,
  SuiteRunResult,
  TaskAttemptResult,
} from "@multibench/core";
import { execFile } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function writeRunArtifacts(options: {
  runDir: string;
  suiteResult: SuiteRunResult;
  events?: HarnessEvent[];
}): Promise<void> {
  await mkdir(options.runDir, { recursive: true });
  await writeJsonAtomic(join(options.runDir, "run.json"), {
    runId: options.suiteResult.runId,
    runDir: options.suiteResult.runDir,
    startedAt: options.suiteResult.startedAt,
    completedAt: options.suiteResult.completedAt,
    status: options.suiteResult.status,
    summary: options.suiteResult.summary,
  });
  await writeJsonAtomic(join(options.runDir, "suite-result.json"), options.suiteResult);
  await writeFileAtomic(
    join(options.runDir, "events.jsonl"),
    (options.events ?? []).map((event) => JSON.stringify(event)).join("\n") +
      ((options.events ?? []).length > 0 ? "\n" : ""),
  );
}

export async function writeAttemptArtifacts(options: {
  attemptDir: string;
  attempt: TaskAttemptResult;
  workspaceDiff?: string;
}): Promise<void> {
  await mkdir(options.attemptDir, { recursive: true });
  await writeJsonAtomic(join(options.attemptDir, "attempt.json"), options.attempt);
  await writeFileAtomic(join(options.attemptDir, "workspace.patch"), options.workspaceDiff ?? "");
}

export async function writeStepArtifacts(options: {
  stepDir: string;
  instruction: string;
  harnessOutput: HarnessStepOutput;
  checks: CheckResult[];
  score: StepScore;
  diff: string;
}): Promise<void> {
  await mkdir(options.stepDir, { recursive: true });
  await writeFileAtomic(join(options.stepDir, "input.txt"), options.instruction);
  await writeJsonAtomic(join(options.stepDir, "harness-output.json"), options.harnessOutput);
  await writeFileAtomic(join(options.stepDir, "diff.patch"), options.diff);
  await writeJsonAtomic(join(options.stepDir, "score.json"), options.score);

  await writeCheckArtifacts(join(options.stepDir, "checks"), options.checks);
}

export async function writeCheckArtifacts(checksDir: string, checks: CheckResult[]): Promise<void> {
  for (const check of checks) {
    const checkDir = join(checksDir, check.id);
    await mkdir(checkDir, { recursive: true });
    await writeJsonAtomic(join(checkDir, "result.json"), check);
    await copyOrCreateEmpty(check.stdoutPath, join(checkDir, "stdout.log"));
    await copyOrCreateEmpty(check.stderrPath, join(checkDir, "stderr.log"));
  }
}

export async function captureWorkspaceDiff(workspaceDir: string): Promise<string> {
  try {
    const result = await execFileAsync("git", ["diff", "--no-index", "--", "/dev/null", "."], {
      cwd: workspaceDir,
      maxBuffer: 10 * 1024 * 1024,
    });
    return result.stdout || (await captureUntrackedWorkspaceDiff(workspaceDir));
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException & { stdout?: string; code?: number };
    if (nodeError.code === 1 && nodeError.stdout !== undefined) {
      return nodeError.stdout || (await captureUntrackedWorkspaceDiff(workspaceDir));
    }
    if (nodeError.code === 129) {
      return "";
    }
    return nodeError.stdout ?? (await captureUntrackedWorkspaceDiff(workspaceDir));
  }
}

async function copyOrCreateEmpty(source: string, destination: string): Promise<void> {
  if (resolve(source) === resolve(destination)) {
    return;
  }

  try {
    await cp(source, destination, { force: true });
  } catch {
    await writeFileAtomic(destination, "");
  }
}

async function captureUntrackedWorkspaceDiff(workspaceDir: string): Promise<string> {
  const files = await listFiles(workspaceDir);
  const chunks = await Promise.all(
    files.map(async (file) => {
      const absolutePath = join(workspaceDir, file);
      const contents = await readFile(absolutePath, "utf8").catch(() => "");
      const lines = contents.split(/\r?\n/);
      if (lines.at(-1) === "") {
        lines.pop();
      }
      return [
        `diff --git a/${file} b/${file}`,
        "new file mode 100644",
        "index 0000000..0000000",
        "--- /dev/null",
        `+++ b/${file}`,
        ...lines.map((line) => `+${line}`),
        "",
      ].join("\n");
    }),
  );
  return chunks.join("");
}

async function listFiles(directory: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(join(directory, prefix), { withFileTypes: true }).catch(() => []);
  const files: string[] = [];

  for (const entry of entries) {
    const relativePath = prefix ? join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await listFiles(directory, relativePath)));
      continue;
    }
    if (entry.isFile() && (await stat(join(directory, relativePath))).isFile()) {
      files.push(relativePath);
    }
  }

  return files.sort();
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeFileAtomic(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempDir = await mkdtemp(join(tmpdir(), "multibench-atomic-"));
  const tempPath = resolve(tempDir, "write.tmp");
  try {
    await writeFile(tempPath, contents, "utf8");
    await rename(tempPath, path);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
