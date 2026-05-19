import type { NormalizedTaskDefinition } from "@multibench/core";
import { parseNormalizedTaskDefinition } from "@multibench/core";
import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { dirname, resolve, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const runnerPackageName = "@multibench/runner";

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

export async function discoverTasks(options: DiscoverTasksOptions): Promise<DiscoveredTask[]> {
  const cwd = resolve(options.cwd);
  const patterns = options.patterns && options.patterns.length > 0 ? options.patterns : defaultPatterns;
  const ignore = [...defaultIgnore, ...(options.ignore ?? [])];
  const files = new Set<string>();

  for (const pattern of patterns) {
    for (const file of await discoverPattern(cwd, pattern, ignore)) {
      files.add(file);
    }
  }

  return [...files]
    .sort((left, right) => left.localeCompare(right))
    .map((file) => ({
      file,
      taskDir: dirname(file),
    }));
}

export async function loadTask(file: string, options?: LoadTaskOptions): Promise<LoadedTask> {
  const cwd = resolve(options?.cwd ?? process.cwd());
  const absoluteFile = resolve(cwd, file);
  const moduleUrl = pathToFileURL(absoluteFile);
  moduleUrl.searchParams.set("mtime", Date.now().toString());

  const importedTask = (await import(moduleUrl.href)) as { default?: unknown };

  if (!("default" in importedTask)) {
    throw new Error(`Task file ${absoluteFile} must have a default export`);
  }

  let definition: NormalizedTaskDefinition;
  try {
    definition = parseNormalizedTaskDefinition(importedTask.default);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to load invalid task definition from ${absoluteFile}: ${error.message}`, {
        cause: error,
      });
    }

    throw error;
  }

  return {
    file: absoluteFile,
    taskDir: dirname(absoluteFile),
    definition,
  };
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

    if (pathStat.isFile() && absolutePath.endsWith(".task.ts") && !isIgnored(absolutePath, ignore, cwd)) {
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

    if (entry.isFile() && entry.name.endsWith(".task.ts") && !isIgnored(absolutePath, ignore, cwd)) {
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

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function toPosixPath(path: string): string {
  return path.split(sep).join("/");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
