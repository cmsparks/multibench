import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../../packages/cli/src/index.js";

const temporaryDirectories: string[] = [];

async function createWorkspace() {
  const directory = await mkdtemp(join(tmpdir(), "multibench-e2e-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeFileEnsured(path: string, contents: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}

async function createDockerFixture(directory: string) {
  const dockerPath = join(directory, "docker");
  await writeFile(
    dockerPath,
    `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const state = ${JSON.stringify(join(directory, "docker-state"))};
mkdirSync(state, { recursive: true });
const args = process.argv.slice(2);

if (args[0] === "image" && args[1] === "inspect") process.exit(0);
if (args[0] === "rm") process.exit(0);
if (args[0] === "version") {
  process.stdout.write("25.0.0\\n");
  process.exit(0);
}
if (args[0] === "run") {
  const workspaceIndex = args.indexOf("-v");
  const workspace = args[workspaceIndex + 1].split(":")[0];
  const counterPath = join(state, "counter");
  const counter = existsSync(counterPath) ? Number(readFileSync(counterPath, "utf8")) + 1 : 1;
  writeFileSync(counterPath, String(counter));
  writeFileSync(join(state, "container-" + counter + ".workspace"), workspace);
  process.stdout.write("container-" + counter + "\\n");
  process.exit(0);
}
if (args[0] === "exec") {
  const container = args.find((arg) => /^container-/.test(arg));
  const workspace = readFileSync(join(state, container + ".workspace"), "utf8");
  const wIndex = args.indexOf("-w");
  const cwd = wIndex === -1 ? workspace : workspace + args[wIndex + 1].slice("/workspace".length);
  const commandIndex = args.indexOf(container) + 1;
  const result = spawnSync(args[commandIndex], args.slice(commandIndex + 1), {
    cwd,
    env: { ...process.env, IN_FAKE_CONTAINER: "1" },
    encoding: "utf8",
  });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  process.exit(result.status ?? 1);
}
process.stderr.write("unexpected docker call " + args.join(" ") + "\\n");
process.exit(2);
`,
  );
  await chmod(dockerPath, 0o755);
}

async function createFixtureTask(cwd: string, passing: boolean) {
  await createDockerFixture(cwd);
  await writeFileEnsured(join(cwd, "tasks", "fixture", "workspace", "status.txt"), "initial\n");
  await writeFileEnsured(
    join(cwd, "tasks", "fixture", "workspace", "tests", "status.test.sh"),
    'test "$(cat status.txt)" = "done"\n',
  );
  await writeFileEnsured(
    join(cwd, "tasks", "fixture", "fixture.task.ts"),
    `
      import { defineTask, dockerEnvironment, fixtureWorkspace, step } from "@multibench/tasks";
      export default defineTask({
        id: "fixture",
        title: "Fixture",
        source: fixtureWorkspace({ path: "workspace" }),
        environment: dockerEnvironment({ image: "node:22-alpine" }),
        instructions: [
          step({ id: "finish", checks: [{ id: "status", command: ["sh", "tests/status.test.sh"] }] })\`
            Write ${passing ? "done" : "wrong"} to status.txt.
          \`,
        ],
      });
    `,
  );
  await writeFileEnsured(
    join(cwd, "harnesses", "edit.harness.ts"),
    `
      export default {
        name: "edit",
        async runStep(input) {
          const fs = await import("node:fs/promises");
          const path = await import("node:path");
          await fs.writeFile(path.join(input.session.workspaceDir, "status.txt"), ${JSON.stringify(passing ? "done\n" : "wrong\n")});
          return { status: "completed", events: [] };
        },
      };
    `,
  );
}

afterEach(async () => {
  const directories = temporaryDirectories.splice(0);
  await Promise.all(
    directories.map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

describe("CLI integration", () => {
  it("full multibench run exits 0 on passing fixture and writes artifacts", async () => {
    const cwd = await createWorkspace();
    await createFixtureTask(cwd, true);

    const exitCode = await runCli(
      ["run", "tasks/fixture", "--harness", "./harnesses/edit.harness.ts", "--run-id", "run-pass"],
      {
        cwd,
        env: { ...process.env, PATH: `${cwd}:${process.env.PATH ?? ""}` },
      },
    );

    expect(exitCode).toBe(0);
  });

  it("full multibench run exits nonzero on failing fixture", async () => {
    const cwd = await createWorkspace();
    await createFixtureTask(cwd, false);

    const exitCode = await runCli(
      ["run", "tasks/fixture", "--harness", "./harnesses/edit.harness.ts", "--run-id", "run-fail"],
      {
        cwd,
        env: { ...process.env, PATH: `${cwd}:${process.env.PATH ?? ""}` },
      },
    );

    expect(exitCode).toBe(1);
  });
});
