#!/usr/bin/env node

import type { Harness } from "@multibench/harness";
import { validateHarness } from "@multibench/harness";
import { parseSuiteRunResult } from "@multibench/core";
import { discoverTasks, loadTask, runSuite } from "@multibench/runner";
import { readFile, rm, writeFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const cliPackageName = "@multibench/cli";

export type ParsedCliArgs = {
  command: "run" | "list" | "validate" | "replay";
  taskPatterns: string[];
  harnessPath?: string;
  harnessOptions: Record<string, unknown>;
  attempts?: number;
  concurrency?: number;
  resultsDir?: string;
  runId?: string;
  timeouts?: {
    stepMs?: number;
    checkMs?: number;
    taskMs?: number;
    suiteMs?: number;
  };
  dryRun: boolean;
  list: boolean;
};

export type LoadHarnessOptions = {
  path: string;
  cwd: string;
  options?: unknown;
};

export type RunCliOptions = {
  cwd?: string;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  env?: NodeJS.ProcessEnv;
};

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const [rawCommand = "run", ...rest] = argv;
  const command = normalizeCommand(rawCommand);
  const taskPatterns: string[] = [];
  const harnessOptions: Record<string, unknown> = {};
  const parsed: ParsedCliArgs = {
    command,
    taskPatterns,
    harnessOptions,
    dryRun: false,
    list: command === "list",
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === undefined) {
      throw new Error("Unexpected missing argument");
    }

    if (!arg.startsWith("--")) {
      taskPatterns.push(arg);
      continue;
    }

    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }

    if (arg === "--list") {
      parsed.list = true;
      continue;
    }

    const value = rest[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${arg} requires a value`);
    }
    index += 1;

    if (arg === "--harness") {
      if (!isPathLike(value)) {
        throw new Error("--harness must be a path to a .harness.ts file");
      }
      parsed.harnessPath = value;
      continue;
    }

    if (arg === "--runs" || arg === "-r") {
      parsed.attempts = parsePositiveInteger(value, arg);
      continue;
    }

    if (arg === "--concurrent" || arg === "-j") {
      parsed.concurrency = parsePositiveInteger(value, arg);
      continue;
    }

    if (arg === "--results-dir") {
      parsed.resultsDir = value;
      continue;
    }

    if (arg === "--run-id") {
      parsed.runId = value;
      continue;
    }

    if (arg === "--timeout-step") {
      parsed.timeouts = { ...parsed.timeouts, stepMs: parseDurationMs(value, arg) };
      continue;
    }

    if (arg === "--timeout-check") {
      parsed.timeouts = { ...parsed.timeouts, checkMs: parseDurationMs(value, arg) };
      continue;
    }

    if (arg === "--timeout-task") {
      parsed.timeouts = { ...parsed.timeouts, taskMs: parseDurationMs(value, arg) };
      continue;
    }

    if (arg === "--timeout-suite") {
      parsed.timeouts = { ...parsed.timeouts, suiteMs: parseDurationMs(value, arg) };
      continue;
    }

    if (arg.startsWith("--harness.")) {
      assignDottedValue(harnessOptions, arg.slice("--harness.".length), parseConservative(value));
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  if (taskPatterns.length === 0) {
    taskPatterns.push("tasks/**/*.task.ts");
  }

  return parsed;
}

export async function loadHarness(options: LoadHarnessOptions): Promise<Harness> {
  const absolutePath = resolve(options.cwd, options.path);
  const loadableModule = await createLoadableModule(absolutePath);

  let imported: { default?: unknown; harness?: unknown };
  try {
    imported = (await import(loadableModule.url.href)) as { default?: unknown; harness?: unknown };
  } finally {
    await rm(loadableModule.file, { force: true });
  }

  const harness = imported.default ?? imported.harness;
  validateHarness(harness);
  await harness.configure?.(options.options ?? {});
  return harness;
}

export async function runCli(argv: string[], options: RunCliOptions = {}): Promise<number> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const stdout = options.stdout ?? ((line: string) => console.log(line));
  const stderr = options.stderr ?? ((line: string) => console.error(line));
  const parsed = parseCliArgs(argv);

  if (parsed.command === "replay") {
    const runId = parsed.taskPatterns[0];
    if (!runId) {
      throw new Error("multibench replay requires a run id");
    }
    const suiteResult = parseSuiteRunResult(
      JSON.parse(
        await readFile(
          resolve(cwd, parsed.resultsDir ?? ".multibench/results", runId, "suite-result.json"),
          "utf8",
        ),
      ),
    );
    stdout(
      `${suiteResult.runId}\t${suiteResult.status}\t${suiteResult.summary.score}/${suiteResult.summary.maxScore}`,
    );
    return suiteResult.status === "completed" ? 0 : 1;
  }

  if (parsed.command === "validate") {
    const discovered = await discoverTasks({ cwd, patterns: parsed.taskPatterns });
    let valid = true;
    for (const task of discovered) {
      try {
        const loaded = await loadTask(task.file, { cwd });
        stdout(`${loaded.definition.id}\tvalid`);
      } catch (error) {
        valid = false;
        stderr(error instanceof Error ? error.message : String(error));
      }
    }
    return valid ? 0 : 1;
  }

  if (parsed.list || parsed.dryRun) {
    const discovered = await discoverTasks({ cwd, patterns: parsed.taskPatterns });
    const loaded = await Promise.all(discovered.map((task) => loadTask(task.file, { cwd })));
    for (const task of loaded) {
      stdout(`${task.definition.id}\t${task.file}`);
    }
    return 0;
  }

  if (!parsed.harnessPath) {
    throw new Error("multibench run requires --harness for execution");
  }

  const harness = await loadHarness({
    path: parsed.harnessPath,
    cwd,
    options: parsed.harnessOptions,
  });

  const result = await runSuite({
    cwd,
    taskPatterns: parsed.taskPatterns,
    harness,
    attempts: parsed.attempts,
    concurrency: parsed.concurrency,
    resultsDir: parsed.resultsDir,
    runId: parsed.runId,
    timeouts: parsed.timeouts,
    env: options.env ?? process.env,
  });
  stdout(`run ${result.runId}: ${result.status}`);
  return result.status === "completed" ? 0 : 1;
}

async function createLoadableModule(file: string): Promise<{ file: string; url: URL }> {
  const source = await readFile(file, "utf8");
  const rewrittenSource = source
    .replaceAll(`from "@multibench/harness"`, `from "${workspaceUrl("harness")}"`)
    .replaceAll(`from '@multibench/harness'`, `from "${workspaceUrl("harness")}"`);
  const javaScriptSource = stripTypeScriptTypes(rewrittenSource, {
    mode: "strip",
    sourceUrl: pathToFileURL(file).href,
  });
  const loadableFile = resolve(
    dirname(file),
    `.multibench-loader-${process.pid}-${Date.now()}-${basename(file, ".ts")}.mjs`,
  );
  await writeFile(loadableFile, javaScriptSource, "utf8");
  return { file: loadableFile, url: pathToFileURL(loadableFile) };
}

function workspaceUrl(packageName: "harness"): string {
  const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
  const outputDirectory = extension === "ts" ? "src" : "dist";
  return new URL(`../../${packageName}/${outputDirectory}/index.${extension}`, import.meta.url)
    .href;
}

function normalizeCommand(command: string): ParsedCliArgs["command"] {
  if (command === "run" || command === "list" || command === "validate" || command === "replay") {
    return command;
  }

  throw new Error(`Unknown command: ${command}`);
}

function parsePositiveInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${option} must be a positive integer`);
  }
  return parsed;
}

function parseConservative(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function parseDurationMs(value: string, option: string): number {
  const match = /^(\d+)(ms|s|m|h)?$/.exec(value);
  if (!match) {
    throw new Error(`${option} must be a duration like 500ms, 30s, 15m, or 1h`);
  }

  const amount = Number(match[1]);
  const unit = match[2] ?? "ms";
  const multiplier = unit === "h" ? 3_600_000 : unit === "m" ? 60_000 : unit === "s" ? 1_000 : 1;
  return amount * multiplier;
}

function assignDottedValue(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cursor: Record<string, unknown> = target;

  for (const part of parts.slice(0, -1)) {
    const existing = cursor[part];
    if (typeof existing !== "object" || existing === null || Array.isArray(existing)) {
      cursor[part] = {};
    }
    cursor = cursor[part] as Record<string, unknown>;
  }

  const key = parts[parts.length - 1]!;
  const existing = cursor[key];
  if (existing === undefined) {
    cursor[key] = value;
  } else if (Array.isArray(existing)) {
    existing.push(value);
  } else {
    cursor[key] = [existing, value];
  }
}

function isPathLike(value: string): boolean {
  return value.startsWith(".") || value.startsWith("/") || value.includes("\\");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runCli(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
