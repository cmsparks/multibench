import type { DockerEnvironment } from "@multibench/core";
import { createHash } from "node:crypto";
import { access, readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { LoadedTask } from "./index.js";

const execFileAsync = promisify(execFile);
const defaultContainerWorkspaceDir = "/workspace";
const defaultContainerArtifactsDir = "/artifacts/harness";

export type DockerCommandOptions = {
  dockerPath?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

export type DockerAvailability = {
  available: boolean;
  version?: string;
  error?: string;
};

export type TaskImage = {
  image: string;
  tag: string;
  built: boolean;
  reused: boolean;
  prebuilt: boolean;
};

export type EnsureTaskImageOptions = DockerCommandOptions & {
  loadedTask: LoadedTask;
};

export type DockerImageLayer = {
  dockerfile: string;
  context: string;
  tagPrefix?: string;
  buildArgs?: Record<string, string>;
};

export type EnsureImageLayerOptions = DockerCommandOptions & {
  baseImage: string;
  layer: DockerImageLayer;
};

export type StartAttemptContainerOptions = DockerCommandOptions & {
  image: string;
  workspaceDir: string;
  artifactsDir: string;
  environment?: DockerEnvironment;
  containerWorkspaceDir?: string;
  containerArtifactsDir?: string;
  name?: string;
};

export type AttemptContainer = {
  containerId: string;
  image: string;
  workspaceDir: string;
  containerWorkspaceDir: string;
  artifactsDir: string;
  containerArtifactsDir: string;
};

export type StopAttemptContainerOptions = DockerCommandOptions & {
  containerId: string;
  preserve?: boolean;
};

export async function checkDockerAvailable(
  options: DockerCommandOptions = {},
): Promise<DockerAvailability> {
  try {
    const result = await runDocker(["version", "--format", "{{.Server.Version}}"], options);
    return {
      available: true,
      version: result.stdout.trim() || undefined,
    };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function ensureTaskImage(options: EnsureTaskImageOptions): Promise<TaskImage> {
  const { loadedTask } = options;
  const environment = loadedTask.definition.environment;

  if (environment.image) {
    return {
      image: environment.image,
      tag: environment.image,
      built: false,
      reused: true,
      prebuilt: true,
    };
  }

  if (!environment.dockerfile && !environment.context) {
    throw new Error("Docker environment must define a Dockerfile, context, or prebuilt image");
  }

  const buildPlan = await createImageBuildPlan(loadedTask);

  if (await dockerImageExists(buildPlan.tag, options)) {
    return {
      image: buildPlan.tag,
      tag: buildPlan.tag,
      built: false,
      reused: true,
      prebuilt: false,
    };
  }

  await runDocker(buildPlan.args, options);

  return {
    image: buildPlan.tag,
    tag: buildPlan.tag,
    built: true,
    reused: false,
    prebuilt: false,
  };
}

export async function ensureImageLayer(options: EnsureImageLayerOptions): Promise<TaskImage> {
  await assertFileExists(options.layer.dockerfile, "Harness Dockerfile");
  await assertDirectoryExists(options.layer.context, "Harness Docker build context");

  const buildArgs = {
    ...(options.layer.buildArgs ?? {}),
    MULTIBENCH_TASK_BASE_IMAGE: options.baseImage,
  };
  const tag = await deterministicLayerTag(options.baseImage, options.layer, buildArgs);

  if (await dockerImageExists(tag, options)) {
    return {
      image: tag,
      tag,
      built: false,
      reused: true,
      prebuilt: false,
    };
  }

  const args = ["build", "-t", tag, "-f", options.layer.dockerfile];
  for (const [key, value] of Object.entries(buildArgs)) {
    args.push("--build-arg", `${key}=${value}`);
  }
  args.push(options.layer.context);
  await runDocker(args, options);

  return {
    image: tag,
    tag,
    built: true,
    reused: false,
    prebuilt: false,
  };
}

export async function startAttemptContainer(
  options: StartAttemptContainerOptions,
): Promise<AttemptContainer> {
  const containerWorkspaceDir = options.containerWorkspaceDir ?? defaultContainerWorkspaceDir;
  const containerArtifactsDir = options.containerArtifactsDir ?? defaultContainerArtifactsDir;
  const args = [
    "run",
    "-d",
    "-v",
    `${options.workspaceDir}:${containerWorkspaceDir}`,
    "-v",
    `${options.artifactsDir}:${containerArtifactsDir}`,
    "-w",
    options.environment?.workingDir ?? containerWorkspaceDir,
  ];

  if (options.name) {
    args.push("--name", options.name);
  }

  for (const [key, value] of Object.entries(options.environment?.env ?? {})) {
    args.push("-e", `${key}=${value}`);
  }

  args.push(options.image, "sh", "-lc", "while :; do sleep 3600; done");

  const result = await runDocker(args, options);
  const containerId = result.stdout.trim();

  if (!containerId) {
    throw new Error("Docker did not return a container id");
  }

  return {
    containerId,
    image: options.image,
    workspaceDir: options.workspaceDir,
    containerWorkspaceDir,
    artifactsDir: options.artifactsDir,
    containerArtifactsDir,
  };
}

export async function stopAttemptContainer(options: StopAttemptContainerOptions): Promise<void> {
  if (options.preserve) {
    return;
  }

  await runDocker(["rm", "-f", options.containerId], options);
}

export async function cleanupContainers(
  containerIds: string[],
  options: DockerCommandOptions = {},
): Promise<void> {
  await Promise.all(
    containerIds.map(async (containerId) => {
      await stopAttemptContainer({ ...options, containerId });
    }),
  );
}

async function createImageBuildPlan(
  loadedTask: LoadedTask,
): Promise<{ tag: string; args: string[] }> {
  const environment = loadedTask.definition.environment;
  const context = resolveBuildContext(loadedTask.taskDir, environment);
  const dockerfile = resolveDockerfile(loadedTask.taskDir, environment, context);

  await assertDirectoryExists(context, "Docker build context");
  if (dockerfile) {
    await assertFileExists(dockerfile, "Dockerfile");
  }

  const mergedBuildArgs = { ...environment.buildArgs };
  const tag = await deterministicImageTag(loadedTask, dockerfile, context, mergedBuildArgs);
  const args = ["build", "-t", tag];

  if (dockerfile) {
    args.push("-f", dockerfile);
  }

  for (const [key, value] of Object.entries(mergedBuildArgs)) {
    args.push("--build-arg", `${key}=${value}`);
  }

  args.push(context);
  return { tag, args };
}

async function deterministicImageTag(
  loadedTask: LoadedTask,
  dockerfile: string | undefined,
  context: string,
  buildArgs: Record<string, string>,
): Promise<string> {
  const hash = createHash("sha256");
  hash.update(loadedTask.file);
  hash.update("\0");
  hash.update(loadedTask.definition.id);
  hash.update("\0");
  hash.update(JSON.stringify(loadedTask.definition.environment));
  hash.update("\0");
  hash.update(JSON.stringify(loadedTask.definition.source));
  hash.update("\0");
  hash.update(JSON.stringify(buildArgs));
  hash.update("\0");
  hash.update(pathToFileURL(context).href);

  if (dockerfile) {
    hash.update("\0");
    hash.update(await readFile(dockerfile, "utf8"));
  }

  const safeTaskId = loadedTask.definition.id.toLowerCase().replace(/[^a-z0-9_.-]+/g, "-");
  return `multibench-task-${safeTaskId}:${hash.digest("hex").slice(0, 16)}`;
}

async function deterministicLayerTag(
  baseImage: string,
  layer: DockerImageLayer,
  buildArgs: Record<string, string>,
): Promise<string> {
  const hash = createHash("sha256");
  hash.update(baseImage);
  hash.update("\0");
  hash.update(layer.dockerfile);
  hash.update("\0");
  hash.update(await readFile(layer.dockerfile, "utf8"));
  hash.update("\0");
  hash.update(layer.context);
  hash.update("\0");
  hash.update(JSON.stringify(buildArgs));

  return `${layer.tagPrefix ?? "multibench-harness-layer"}:${hash.digest("hex").slice(0, 16)}`;
}

function resolveBuildContext(taskDir: string, environment: DockerEnvironment): string {
  if (environment.context) {
    return resolve(taskDir, environment.context);
  }

  return taskDir;
}

function resolveDockerfile(
  taskDir: string,
  environment: DockerEnvironment,
  context: string,
): string | undefined {
  if (environment.dockerfile) {
    return resolve(taskDir, environment.dockerfile);
  }

  if (environment.context) {
    return resolve(context, "Dockerfile");
  }

  return undefined;
}

async function dockerImageExists(image: string, options: DockerCommandOptions): Promise<boolean> {
  try {
    await runDocker(["image", "inspect", image], options);
    return true;
  } catch {
    return false;
  }
}

async function assertFileExists(path: string, description: string): Promise<void> {
  const pathStat = await stat(path).catch(() => undefined);
  if (!pathStat?.isFile()) {
    throw new Error(`${description} does not exist: ${path}`);
  }
}

async function assertDirectoryExists(path: string, description: string): Promise<void> {
  const pathStat = await stat(path).catch(() => undefined);
  if (!pathStat?.isDirectory()) {
    throw new Error(`${description} does not exist: ${path}`);
  }
}

async function runDocker(args: string[], options: DockerCommandOptions) {
  await access(dirname(resolveDockerExecutable(options.dockerPath))).catch(() => undefined);
  return execFileAsync(resolveDockerExecutable(options.dockerPath), args, {
    cwd: options.cwd,
    env: options.env,
  });
}

function resolveDockerExecutable(dockerPath?: string): string {
  return dockerPath ?? "docker";
}
