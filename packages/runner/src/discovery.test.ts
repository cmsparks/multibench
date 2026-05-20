import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverTasks, loadTask } from "./index.js";

const temporaryDirectories: string[] = [];

async function createWorkspace() {
  const directory = await mkdtemp(join(tmpdir(), "multibench-runner-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeWorkspaceFile(cwd: string, file: string, contents: string) {
  const absolutePath = join(cwd, file);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents, "utf8");
  return absolutePath;
}

function validTaskFile(taskId: string, title = "Valid task") {
  return `
    import { defineTask, dockerEnvironment, step } from "@multibench/tasks";

    export default defineTask({
      id: ${JSON.stringify(taskId)},
      title: ${JSON.stringify(title)},
      environment: dockerEnvironment({ dockerfile: "Dockerfile" }),
      instructions: [
        step({ id: "first-step" })\`
          Update the workspace file.
        \`,
      ],
    });
  `;
}

afterEach(async () => {
  const directories = temporaryDirectories.splice(0);
  await Promise.all(
    directories.map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

describe("discoverTasks", () => {
  it("with no path discovers tasks/**/*.task.ts", async () => {
    const cwd = await createWorkspace();
    const taskFile = await writeWorkspaceFile(
      cwd,
      "tasks/basic/basic.task.ts",
      validTaskFile("basic"),
    );
    await writeWorkspaceFile(cwd, "not-tasks/ignored.task.ts", validTaskFile("ignored"));

    await expect(discoverTasks({ cwd })).resolves.toEqual([
      {
        file: taskFile,
        taskDir: dirname(taskFile),
      },
    ]);
  });

  it("explicit file path loads one task", async () => {
    const cwd = await createWorkspace();
    const selectedTask = await writeWorkspaceFile(
      cwd,
      "fixtures/selected.task.ts",
      validTaskFile("selected"),
    );
    await writeWorkspaceFile(cwd, "fixtures/other.task.ts", validTaskFile("other"));

    await expect(discoverTasks({ cwd, patterns: ["fixtures/selected.task.ts"] })).resolves.toEqual([
      {
        file: selectedTask,
        taskDir: dirname(selectedTask),
      },
    ]);
  });

  it("directory path discovers nested task files", async () => {
    const cwd = await createWorkspace();
    const firstTask = await writeWorkspaceFile(cwd, "suite/one.task.ts", validTaskFile("one"));
    const secondTask = await writeWorkspaceFile(
      cwd,
      "suite/nested/two.task.ts",
      validTaskFile("two"),
    );
    await writeWorkspaceFile(cwd, "outside/three.task.ts", validTaskFile("three"));

    await expect(discoverTasks({ cwd, patterns: ["suite"] })).resolves.toEqual([
      {
        file: firstTask,
        taskDir: dirname(firstTask),
      },
      {
        file: secondTask,
        taskDir: dirname(secondTask),
      },
    ]);
  });

  it("glob discovers multiple task files", async () => {
    const cwd = await createWorkspace();
    const firstTask = await writeWorkspaceFile(cwd, "cases/a.task.ts", validTaskFile("a"));
    const secondTask = await writeWorkspaceFile(cwd, "cases/nested/b.task.ts", validTaskFile("b"));
    await writeWorkspaceFile(cwd, "cases/not-a-task.ts", validTaskFile("not-a-task"));

    await expect(discoverTasks({ cwd, patterns: ["cases/**/*.task.ts"] })).resolves.toEqual([
      {
        file: firstTask,
        taskDir: dirname(firstTask),
      },
      {
        file: secondTask,
        taskDir: dirname(secondTask),
      },
    ]);
  });

  it("ignored directories are ignored", async () => {
    const cwd = await createWorkspace();
    const realTask = await writeWorkspaceFile(cwd, "tasks/real.task.ts", validTaskFile("real"));
    await writeWorkspaceFile(
      cwd,
      "tasks/node_modules/package/ignored.task.ts",
      validTaskFile("node"),
    );
    await writeWorkspaceFile(cwd, "tasks/dist/ignored.task.ts", validTaskFile("dist"));
    await writeWorkspaceFile(cwd, "tasks/.multibench/ignored.task.ts", validTaskFile("state"));

    await expect(discoverTasks({ cwd, patterns: ["tasks/**/*.task.ts"] })).resolves.toEqual([
      {
        file: realTask,
        taskDir: dirname(realTask),
      },
    ]);
  });
});

describe("loadTask", () => {
  it("missing default export fails clearly", async () => {
    const cwd = await createWorkspace();
    const taskFile = await writeWorkspaceFile(
      cwd,
      "tasks/missing-default.task.ts",
      `
        export const task = {
          id: "missing-default",
        };
      `,
    );

    await expect(loadTask(taskFile, { cwd })).rejects.toThrow(/default export/i);
  });

  it("invalid task definition fails clearly", async () => {
    const cwd = await createWorkspace();
    const taskFile = await writeWorkspaceFile(
      cwd,
      "tasks/invalid.task.ts",
      `
        export default {
          id: "invalid",
          instructions: [],
        };
      `,
    );

    await expect(loadTask(taskFile, { cwd })).rejects.toThrow(
      /invalid|normalized task definition|title/i,
    );
  });

  it("valid task file normalizes successfully", async () => {
    const cwd = await createWorkspace();
    const taskFile = await writeWorkspaceFile(
      cwd,
      "tasks/valid.task.ts",
      validTaskFile("valid", "Valid loaded task"),
    );

    await expect(loadTask(taskFile, { cwd })).resolves.toEqual({
      file: taskFile,
      taskDir: dirname(taskFile),
      definition: {
        id: "valid",
        title: "Valid loaded task",
        style: [],
        source: {
          type: "fixture",
          path: ".",
        },
        environment: {
          dockerfile: "Dockerfile",
        },
        instructions: [
          {
            id: "first-step",
            index: 0,
            instruction: "Update the workspace file.",
            checks: [
              {
                id: "first-step",
                command: ["pnpm", "vitest", "run", "tests/first-step.test.ts"],
              },
            ],
          },
        ],
        checks: [
          {
            id: "first-step",
            command: ["pnpm", "vitest", "run", "tests/first-step.test.ts"],
          },
        ],
        finalChecks: [],
      },
    });
  });
});
