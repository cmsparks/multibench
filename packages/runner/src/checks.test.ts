import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CheckDefinition } from "@multibench/core";
import { runChecks } from "./checks.js";

const temporaryDirectories: string[] = [];

async function createWorkspace() {
  const directory = await mkdtemp(join(tmpdir(), "multibench-checks-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeFileEnsured(path: string, contents: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}

async function createDockerExecFixture(directory: string, workspaceDir: string) {
  const dockerPath = join(directory, "docker");

  await writeFile(
    dockerPath,
    `#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
if (args[0] !== "exec") {
  process.stderr.write("expected docker exec, got " + args.join(" ") + "\\n");
  process.exit(2);
}

let cwd = ${JSON.stringify(workspaceDir)};
const env = { ...process.env, IN_FAKE_CONTAINER: "1" };
let index = 1;
while (index < args.length) {
  const arg = args[index];
  if (arg === "-w") {
    const containerCwd = args[index + 1];
    cwd = containerCwd === "/workspace" ? ${JSON.stringify(workspaceDir)} : ${JSON.stringify(workspaceDir)} + containerCwd.slice("/workspace".length);
    index += 2;
    continue;
  }
  if (arg === "-e") {
    const [key, ...parts] = String(args[index + 1]).split("=");
    env[key] = parts.join("=");
    index += 2;
    continue;
  }
  break;
}

index += 1; // container id
const result = spawnSync(args[index], args.slice(index + 1), {
  cwd,
  env,
  encoding: "utf8",
});
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
process.exit(result.status ?? 1);
`,
    "utf8",
  );
  await chmod(dockerPath, 0o755);
  return dockerPath;
}

afterEach(async () => {
  const directories = temporaryDirectories.splice(0);
  await Promise.all(
    directories.map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

describe("runChecks", () => {
  it("passing check returns passed and writes stdout/stderr artifacts", async () => {
    const cwd = await createWorkspace();
    const workspaceDir = join(cwd, "workspace");
    const artifactsDir = join(cwd, "artifacts");
    await mkdir(workspaceDir, { recursive: true });
    const dockerPath = await createDockerExecFixture(cwd, workspaceDir);

    const [result] = await runChecks({
      checks: [{ id: "pass", command: ["sh", "-lc", "echo out; echo err >&2"] }],
      containerId: "container-001",
      containerWorkspaceDir: "/workspace",
      artifactDir: artifactsDir,
      dockerPath,
    });

    expect(result).toMatchObject({
      id: "pass",
      status: "passed",
      command: ["sh", "-lc", "echo out; echo err >&2"],
      cwd: "/workspace",
      exitCode: 0,
    });
    await expect(readFile(result!.stdoutPath, "utf8")).resolves.toBe("out\n");
    await expect(readFile(result!.stderrPath, "utf8")).resolves.toBe("err\n");
  });

  it("failing check returns failed", async () => {
    const cwd = await createWorkspace();
    const workspaceDir = join(cwd, "workspace");
    await mkdir(workspaceDir, { recursive: true });
    const dockerPath = await createDockerExecFixture(cwd, workspaceDir);

    const [result] = await runChecks({
      checks: [{ id: "fail", command: ["sh", "-lc", "exit 7"] }],
      containerId: "container-001",
      containerWorkspaceDir: "/workspace",
      artifactDir: join(cwd, "artifacts"),
      dockerPath,
    });

    expect(result).toMatchObject({ id: "fail", status: "failed", exitCode: 7 });
  });

  it("timed-out check returns timed-out", async () => {
    const cwd = await createWorkspace();
    const workspaceDir = join(cwd, "workspace");
    await mkdir(workspaceDir, { recursive: true });
    const dockerPath = await createDockerExecFixture(cwd, workspaceDir);

    const [result] = await runChecks({
      checks: [{ id: "timeout", command: ["sh", "-lc", "sleep 2"], timeoutMs: 50 }],
      containerId: "container-001",
      containerWorkspaceDir: "/workspace",
      artifactDir: join(cwd, "artifacts"),
      dockerPath,
    });

    expect(result).toMatchObject({ id: "timeout", status: "timed-out" });
  });

  it("runs commands inside the container workspace with cwd and env", async () => {
    const cwd = await createWorkspace();
    const workspaceDir = join(cwd, "workspace");
    await writeFileEnsured(join(workspaceDir, "subdir", "marker.txt"), "inside\n");
    const dockerPath = await createDockerExecFixture(cwd, workspaceDir);

    const [result] = await runChecks({
      checks: [
        {
          id: "container",
          command: [
            "sh",
            "-lc",
            'test "$IN_FAKE_CONTAINER" = 1 && test "$CUSTOM" = value && cat marker.txt',
          ],
          cwd: "subdir",
          env: { CUSTOM: "value" },
        },
      ],
      containerId: "container-001",
      containerWorkspaceDir: "/workspace",
      artifactDir: join(cwd, "artifacts"),
      dockerPath,
    });

    expect(result).toMatchObject({ status: "passed", cwd: "/workspace/subdir" });
    await expect(readFile(result!.stdoutPath, "utf8")).resolves.toBe("inside\n");
    await expect(stat(result!.stderrPath)).resolves.toMatchObject({ size: 0 });
  });

  it("skips checks when requested", async () => {
    const cwd = await createWorkspace();
    const results = await runChecks({
      checks: [{ id: "skip", command: ["sh", "-lc", "exit 1"] }],
      containerId: "container-001",
      containerWorkspaceDir: "/workspace",
      artifactDir: join(cwd, "artifacts"),
      skip: true,
    });

    expect(results).toEqual([
      expect.objectContaining({
        id: "skip",
        status: "skipped",
        cwd: "/workspace",
        exitCode: undefined,
      }),
    ]);
  });

  it("normalizes string check paths to TypeScript test commands", async () => {
    const normalized = runChecks.normalize(
      ["tests/step.test.ts"] as unknown as CheckDefinition[],
      "step",
    );

    expect(normalized).toEqual([
      {
        id: "step",
        command: ["tsx", "tests/step.test.ts"],
        metadata: { runner: "host" },
      },
    ]);
  });

  it("runs TypeScript check files on the host against the host workspace", async () => {
    const cwd = await createWorkspace();
    const workspaceDir = join(cwd, "workspace");
    const checkFile = join(cwd, "checks", "host-check.ts");
    const dockerPath = join(cwd, "docker");
    await writeFileEnsured(join(workspaceDir, "marker.txt"), "host workspace\n");
    await writeFileEnsured(
      checkFile,
      `
        import { readFileSync } from "node:fs";
        import { join } from "node:path";

        if (process.env.IN_FAKE_CONTAINER) {
          throw new Error("host check ran inside container");
        }

        const contents = readFileSync(join(process.env.MULTIBENCH_WORKSPACE_DIR!, "marker.txt"), "utf8");
        process.stdout.write(contents);
      `,
    );
    await writeFile(dockerPath, "#!/usr/bin/env sh\necho should-not-run >&2\nexit 99\n");
    await chmod(dockerPath, 0o755);

    const [result] = await runChecks({
      checks: [
        {
          id: "host-ts",
          command: ["tsx", checkFile],
          metadata: { runner: "host" },
        },
      ],
      containerId: "container-001",
      workspaceDir,
      containerWorkspaceDir: "/workspace",
      artifactDir: join(cwd, "artifacts"),
      dockerPath,
      env: {
        ...process.env,
        PATH: `${process.env.PATH ?? ""}`,
      },
    });

    expect(result).toMatchObject({
      id: "host-ts",
      status: "passed",
      cwd: workspaceDir,
      exitCode: 0,
    });
    await expect(readFile(result!.stdoutPath, "utf8")).resolves.toBe("host workspace\n");
  });
});
