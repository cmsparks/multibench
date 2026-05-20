import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LoadedTask } from "./index.js";
import {
  checkDockerAvailable,
  ensureImageLayer,
  ensureTaskImage,
  startAttemptContainer,
  stopAttemptContainer,
} from "./docker.js";

const temporaryDirectories: string[] = [];

async function createWorkspace() {
  const directory = await mkdtemp(join(tmpdir(), "multibench-docker-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeFileEnsured(path: string, contents: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}

async function createFakeDocker(directory: string) {
  const dockerPath = join(directory, "fake-docker.mjs");
  const logPath = join(directory, "docker-calls.jsonl");
  const stateDir = join(directory, "state");
  await mkdir(stateDir, { recursive: true });
  await writeFile(
    dockerPath,
    `#!/usr/bin/env node
import { appendFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const logPath = ${JSON.stringify(logPath)};
const stateDir = ${JSON.stringify(stateDir)};
const args = process.argv.slice(2);
appendFileSync(logPath, JSON.stringify(args) + "\\n");
mkdirSync(join(stateDir, "images"), { recursive: true });
const imageFile = (image) => join(stateDir, "images", Buffer.from(image).toString("base64url"));

if (args[0] === "version") {
  process.stdout.write("25.0.0\\n");
  process.exit(0);
}

if (args[0] === "image" && args[1] === "inspect") {
  process.exit(existsSync(imageFile(args[2])) ? 0 : 1);
}

if (args[0] === "build") {
  const tag = args[args.indexOf("-t") + 1];
  writeFileSync(imageFile(tag), "");
  process.exit(0);
}

if (args[0] === "run") {
  process.stdout.write("container-123\\n");
  process.exit(0);
}

if (args[0] === "rm") {
  process.exit(0);
}

process.stderr.write("unexpected fake docker call: " + args.join(" ") + "\\n");
process.exit(2);
`,
    "utf8",
  );
  await chmod(dockerPath, 0o755);
  return { dockerPath, logPath };
}

async function readDockerCalls(logPath: string): Promise<string[][]> {
  const contents = await readFile(logPath, "utf8").catch(() => "");
  return contents
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[]);
}

function loadedTaskFixture(
  directory: string,
  environment: LoadedTask["definition"]["environment"],
): LoadedTask {
  return {
    file: join(directory, "example.task.ts"),
    taskDir: directory,
    definition: {
      id: "Example Task",
      title: "Example task",
      style: [],
      source: { type: "fixture", path: "workspace" },
      environment,
      instructions: [],
      checks: [],
      finalChecks: [],
    },
  };
}

afterEach(async () => {
  const directories = temporaryDirectories.splice(0);
  await Promise.all(
    directories.map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

describe("docker lifecycle", () => {
  it("checks Docker availability", async () => {
    const cwd = await createWorkspace();
    const { dockerPath } = await createFakeDocker(cwd);

    await expect(checkDockerAvailable({ dockerPath })).resolves.toEqual({
      available: true,
      version: "25.0.0",
    });
  });

  it("builds an image from a root Dockerfile and reuses the cached tag", async () => {
    const cwd = await createWorkspace();
    const { dockerPath, logPath } = await createFakeDocker(cwd);
    await writeFileEnsured(join(cwd, "Dockerfile"), "FROM alpine\n");
    const loadedTask = loadedTaskFixture(cwd, { dockerfile: "Dockerfile" });

    const first = await ensureTaskImage({ loadedTask, dockerPath });
    const second = await ensureTaskImage({ loadedTask, dockerPath });

    expect(first).toMatchObject({ built: true, reused: false, prebuilt: false });
    expect(second).toEqual({ ...first, built: false, reused: true });
    expect(first.tag).toMatch(/^multibench-task-example-task:[a-f0-9]{16}$/);

    const calls = await readDockerCalls(logPath);
    expect(calls.filter((call) => call[0] === "build")).toHaveLength(1);
    expect(calls.find((call) => call[0] === "build")).toEqual([
      "build",
      "-t",
      first.tag,
      "-f",
      join(cwd, "Dockerfile"),
      cwd,
    ]);
  });

  it("builds a harness image layer from a task base image", async () => {
    const cwd = await createWorkspace();
    const { dockerPath, logPath } = await createFakeDocker(cwd);
    await writeFileEnsured(
      join(cwd, "Harness.Dockerfile"),
      "ARG MULTIBENCH_TASK_BASE_IMAGE\nFROM ${MULTIBENCH_TASK_BASE_IMAGE}\n",
    );

    const image = await ensureImageLayer({
      dockerPath,
      baseImage: "multibench-task-example:abc123",
      layer: {
        dockerfile: join(cwd, "Harness.Dockerfile"),
        context: cwd,
        tagPrefix: "multibench-harness-claude-code",
        buildArgs: {
          CLAUDE_CODE_VERSION: "1.2.3",
        },
      },
    });

    const calls = await readDockerCalls(logPath);
    expect(calls.find((call) => call[0] === "build")).toEqual([
      "build",
      "-t",
      image.tag,
      "-f",
      join(cwd, "Harness.Dockerfile"),
      "--build-arg",
      "CLAUDE_CODE_VERSION=1.2.3",
      "--build-arg",
      "MULTIBENCH_TASK_BASE_IMAGE=multibench-task-example:abc123",
      cwd,
    ]);
  });

  it("builds an image from a docker/ context", async () => {
    const cwd = await createWorkspace();
    const { dockerPath, logPath } = await createFakeDocker(cwd);
    await writeFileEnsured(join(cwd, "docker", "Dockerfile"), "FROM alpine\n");
    const loadedTask = loadedTaskFixture(cwd, { context: "docker" });

    const image = await ensureTaskImage({ loadedTask, dockerPath });

    const calls = await readDockerCalls(logPath);
    expect(calls.find((call) => call[0] === "build")).toEqual([
      "build",
      "-t",
      image.tag,
      "-f",
      join(cwd, "docker", "Dockerfile"),
      join(cwd, "docker"),
    ]);
  });

  it("uses a prebuilt image reference without building", async () => {
    const cwd = await createWorkspace();
    const { dockerPath, logPath } = await createFakeDocker(cwd);
    const loadedTask = loadedTaskFixture(cwd, { image: "node:22" });

    await expect(ensureTaskImage({ loadedTask, dockerPath })).resolves.toEqual({
      image: "node:22",
      tag: "node:22",
      built: false,
      reused: true,
      prebuilt: true,
    });
    expect(await readDockerCalls(logPath)).toEqual([]);
  });

  it("fails before a run when no Docker environment source is configured", async () => {
    const cwd = await createWorkspace();
    const { dockerPath } = await createFakeDocker(cwd);
    const loadedTask = loadedTaskFixture(cwd, {});

    await expect(ensureTaskImage({ loadedTask, dockerPath })).rejects.toThrow(
      /Dockerfile|context/i,
    );
  });

  it("starts a container with workspace and harness artifact mounts", async () => {
    const cwd = await createWorkspace();
    const { dockerPath, logPath } = await createFakeDocker(cwd);
    const workspaceDir = join(cwd, "workspace");
    const artifactsDir = join(cwd, "artifacts", "harness");
    await mkdir(workspaceDir, { recursive: true });
    await mkdir(artifactsDir, { recursive: true });

    await expect(
      startAttemptContainer({
        dockerPath,
        image: "node:22",
        workspaceDir,
        artifactsDir,
        environment: {
          image: "node:22",
          env: { API_KEY: "test" },
          workingDir: "/workspace/project",
        },
      }),
    ).resolves.toMatchObject({
      containerId: "container-123",
      containerWorkspaceDir: "/workspace",
      containerArtifactsDir: "/artifacts/harness",
    });

    const calls = await readDockerCalls(logPath);
    expect(calls[0]).toEqual([
      "run",
      "-d",
      "-v",
      `${workspaceDir}:/workspace`,
      "-v",
      `${artifactsDir}:/artifacts/harness`,
      "-w",
      "/workspace/project",
      "-e",
      "API_KEY=test",
      "node:22",
      "sh",
      "-lc",
      "while :; do sleep 3600; done",
    ]);
  });

  it("removes successful containers and preserves failed containers when configured", async () => {
    const cwd = await createWorkspace();
    const { dockerPath, logPath } = await createFakeDocker(cwd);

    await stopAttemptContainer({ dockerPath, containerId: "success-container" });
    await stopAttemptContainer({ dockerPath, containerId: "failed-container", preserve: true });

    expect(await readDockerCalls(logPath)).toEqual([["rm", "-f", "success-container"]]);
  });
});
