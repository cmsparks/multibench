import type { NormalizedTaskDefinition } from "@multibench/core";
import { parseNormalizedTaskDefinition } from "@multibench/core";
import type { Dirent } from "node:fs";
import { readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { basename, dirname, resolve, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const runnerPackageName = "@multibench/runner";

export type {
  RunnerReporter,
  RunnerRunContext,
  RunnerTimeouts,
  RunTaskOptions,
} from "./runTask.js";
export { runTask } from "./runTask.js";
export type { RunSuiteOptions } from "./runSuite.js";
export { runSuite } from "./runSuite.js";

export type DiscoverTasksOptions = {
  cwd: string;
  patterns?: string[];
  ignore?: string[];
};

export type DiscoveredTask = {
  file: string;
  taskDir: string;
};

export type LoadTaskOptions = {
  cwd: string;
};

export type LoadedTask = {
  file: string;
  taskDir: string;
  definition: NormalizedTaskDefinition;
};

const defaultPatterns = ["tasks/**/*.task.ts"];
const defaultIgnore = ["**/node_modules/**", "**/dist/**", "**/.multibench/**"];
const ignoredDirectoryNames = new Set(["node_modules", "dist", ".multibench"]);
const moduleExtension = import.meta.url.endsWith(".ts") ? "ts" : "js";
const packageOutputDirectory = moduleExtension === "ts" ? "src" : "dist";
const workspacePackageUrls = new Map([
  [
    "@multibench/core",
    new URL(`../../core/${packageOutputDirectory}/index.${moduleExtension}`, import.meta.url).href,
  ],
  ["@multibench/tasks", new URL(`./task-loader-api.${moduleExtension}`, import.meta.url).href],
]);

export async function discoverTasks(options: DiscoverTasksOptions): Promise<DiscoveredTask[]> {
  const cwd = resolve(options.cwd);
  const patterns =
    options.patterns && options.patterns.length > 0 ? options.patterns : defaultPatterns;
  const ignore = [...defaultIgnore, ...(options.ignore ?? [])];
  const files = new Set<string>();

  for (const pattern of patterns) {
    for (const file of await discoverPattern(cwd, pattern, ignore)) {
      files.add(file);
    }
  }

  return [...files]
    .sort((left, right) => compareTaskPaths(cwd, left, right))
    .map((file) => ({
      file,
      taskDir: dirname(file),
    }));
}

export async function loadTask(file: string, options?: LoadTaskOptions): Promise<LoadedTask> {
  const cwd = resolve(options?.cwd ?? process.cwd());
  const absoluteFile = resolve(cwd, file);
  const loadableModule = await createLoadableTaskModule(absoluteFile);

  let importedTask: { default?: unknown };
  try {
    importedTask = (await import(loadableModule.url.href)) as { default?: unknown };
  } finally {
    await rm(loadableModule.file, { force: true });
  }

  if (!("default" in importedTask)) {
    throw new Error(`Task file ${absoluteFile} must have a default export`);
  }

  let definition: NormalizedTaskDefinition;
  try {
    definition = parseNormalizedTaskDefinition(importedTask.default);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(
        `Failed to load invalid task definition from ${absoluteFile}: ${error.message}`,
        {
          cause: error,
        },
      );
    }

    throw error;
  }

  return {
    file: absoluteFile,
    taskDir: dirname(absoluteFile),
    definition,
  };
}

async function createLoadableTaskModule(file: string): Promise<{ file: string; url: URL }> {
  const source = await readFile(file, "utf8");
  const rewrittenSource = rewriteWorkspacePackageImports(source);
  const javaScriptSource = stripTypeScriptTypes(rewrittenSource, {
    mode: "strip",
    sourceUrl: pathToFileURL(file).href,
  });
  const loadableFile = resolve(
    dirname(file),
    `.multibench-loader-${process.pid}-${Date.now()}-${basename(file, ".ts")}.mjs`,
  );

  await writeFile(loadableFile, javaScriptSource, "utf8");
  return {
    file: loadableFile,
    url: pathToFileURL(loadableFile),
  };
}

function rewriteWorkspacePackageImports(source: string): string {
  let rewrittenSource = source;

  for (const [specifier, url] of workspacePackageUrls) {
    rewrittenSource = rewrittenSource
      .replaceAll(`from "${specifier}"`, `from "${url}"`)
      .replaceAll(`from '${specifier}'`, `from '${url}'`)
      .replaceAll(`import("${specifier}")`, `import("${url}")`)
      .replaceAll(`import('${specifier}')`, `import('${url}')`);
  }

  return rewrittenSource;
}

async function discoverPattern(cwd: string, pattern: string, ignore: string[]): Promise<string[]> {
  const absolutePath = resolve(cwd, pattern);

  if (!hasGlob(pattern)) {
    const pathStat = await statIfExists(absolutePath);

    if (!pathStat) {
      return [];
    }

    if (pathStat.isDirectory()) {
      return walkTaskFiles(absolutePath, ignore, cwd);
    }

    if (
      pathStat.isFile() &&
      absolutePath.endsWith(".task.ts") &&
      !isIgnored(absolutePath, ignore, cwd)
    ) {
      return [absolutePath];
    }

    return [];
  }

  const matchesPattern = globMatcher(pattern);
  const candidateFiles = await walkTaskFiles(cwd, ignore, cwd);

  return candidateFiles.filter((file) => matchesPattern(toPosixPath(relative(cwd, file))));
}

async function walkTaskFiles(directory: string, ignore: string[], cwd: string): Promise<string[]> {
  const files: string[] = [];

  if (isIgnored(directory, ignore, cwd)) {
    return files;
  }

  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      return files;
    }

    throw error;
  }

  for (const entry of entries) {
    const absolutePath = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      if (!ignoredDirectoryNames.has(entry.name)) {
        files.push(...(await walkTaskFiles(absolutePath, ignore, cwd)));
      }
      continue;
    }

    if (
      entry.isFile() &&
      entry.name.endsWith(".task.ts") &&
      !isIgnored(absolutePath, ignore, cwd)
    ) {
      files.push(absolutePath);
    }
  }

  return files;
}

async function statIfExists(path: string) {
  try {
    return await stat(path);
  } catch (error) {
    if (isNodeError(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      return undefined;
    }

    throw error;
  }
}

function hasGlob(pattern: string): boolean {
  return /[*?[\]{}]/.test(pattern);
}

function isIgnored(path: string, ignore: string[], cwd: string): boolean {
  const relativePath = toPosixPath(relative(cwd, path));
  const segments = relativePath.split("/");

  if (segments.some((segment) => ignoredDirectoryNames.has(segment))) {
    return true;
  }

  return ignore.some((pattern) => globMatcher(pattern)(relativePath));
}

function globMatcher(pattern: string): (path: string) => boolean {
  const normalizedPattern = toPosixPath(pattern);
  const expression = globToRegExp(normalizedPattern);

  return (path: string) => expression.test(toPosixPath(path));
}

function globToRegExp(pattern: string): RegExp {
  let expression = "^";

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    const next = pattern[index + 1];

    if (character === "*" && next === "*") {
      const afterGlobstar = pattern[index + 2];

      if (afterGlobstar === "/") {
        expression += "(?:.*\\/)?";
        index += 2;
      } else {
        expression += ".*";
        index += 1;
      }
      continue;
    }

    if (character === "*") {
      expression += "[^/]*";
      continue;
    }

    if (character === "?") {
      expression += "[^/]";
      continue;
    }

    expression += escapeRegExp(character ?? "");
  }

  expression += "$";
  return new RegExp(expression);
}

function compareTaskPaths(cwd: string, left: string, right: string): number {
  const leftRelative = toPosixPath(relative(cwd, left));
  const rightRelative = toPosixPath(relative(cwd, right));
  const leftDepth = leftRelative.split("/").length;
  const rightDepth = rightRelative.split("/").length;

  if (leftDepth !== rightDepth) {
    return leftDepth - rightDepth;
  }

  return leftRelative < rightRelative ? -1 : leftRelative > rightRelative ? 1 : 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function toPosixPath(path: string): string {
  return path.split(sep).join("/");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export * from "./docker.js";
export * from "./workspace.js";
