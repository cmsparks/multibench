import { cp, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { loadTask } from "@multibench/runner";

const execFileAsync = promisify(execFile);
const taskFile = new URL("./memcached-command-rollback.task.ts", import.meta.url).pathname;
const taskDir = dirname(taskFile);

async function copyBaseline() {
  const directory = await mkdtemp(join(tmpdir(), "multibench-memcached-"));
  await cp(join(taskDir, "workspace"), directory, { recursive: true });
  return directory;
}

async function runCheck(workspaceDir: string, check: string) {
  return execFileAsync(process.execPath, [join(taskDir, "checks", check)], {
    cwd: workspaceDir,
    env: {
      ...process.env,
      MULTIBENCH_WORKSPACE_DIR: workspaceDir,
    },
  });
}

async function applySolutionPatch(workspaceDir: string, stepId: string) {
  return execFileAsync("git", ["apply", "--recount", join(taskDir, "solution", `${stepId}.patch`)], {
    cwd: workspaceDir,
    env: {
      ...process.env,
      GIT_CEILING_DIRECTORIES: dirname(workspaceDir),
    },
  });
}

const touch2OnlyProtocolSource = `
export function createProtocol() {
  const items = new Map();
  let nextCas = 1;
  return {
    execute(input) {
      const [command = "", ...parts] = input.trim().split(/\\s+/);
      const normalized = command.toUpperCase();
      if (normalized === "SET") {
        const [key, flags, exptime, ...valueParts] = parts;
        items.set(key, {
          key,
          flags: Number(flags),
          exptime: Number(exptime),
          value: valueParts.join(" "),
          cas: nextCas++,
        });
        return "STORED";
      }
      if (normalized === "GET") {
        const item = items.get(parts[0]);
        return item ? \`VALUE \${item.key} \${item.flags} \${item.value.length}\\n\${item.value}\\nEND\` : "END";
      }
      if (normalized === "META") {
        const item = items.get(parts[0]);
        return item ? \`META \${item.key} flags=\${item.flags} bytes=\${item.value.length} exptime=\${item.exptime} cas=\${item.cas}\` : "NOT_FOUND";
      }
      if (normalized === "TOUCH") {
        const item = items.get(parts[0]);
        if (!item) return "NOT_FOUND";
        item.exptime = Number(parts[1]);
        item.cas = nextCas++;
        return "TOUCHED";
      }
      if (normalized === "TOUCH2") {
        const item = items.get(parts[0]);
        if (!item) return "NOT_FOUND";
        item.exptime = Number(parts[1]);
        item.cas = nextCas++;
        return \`VALUE \${item.key} \${item.flags} \${item.value.length}\\n\${item.value}\\nEXPTIME \${item.exptime}\\nEND\`;
      }
      return "ERROR";
    },
  };
}
`;

const touch2AndCasmetaProtocolSource = touch2OnlyProtocolSource.replace(
  '      if (normalized === "TOUCH2") {',
  `      if (normalized === "CASMETA") {
        const item = items.get(parts[0]);
        if (!item) return "NOT_FOUND";
        item.cas = Number(parts[1]);
        return "UPDATED";
      }
      if (normalized === "TOUCH2") {`,
);

describe("memcached command rollback task", () => {
  it("loads and defines the expected three-step rollback workflow", async () => {
    const loaded = await loadTask(taskFile, { cwd: taskDir });

    expect(loaded.definition).toMatchObject({
      id: "memcached-command-rollback",
      title: expect.stringMatching(/memcached/i),
    });
    expect(loaded.definition.instructions.map((step) => step.id)).toEqual([
      "add-touch2",
      "add-casmeta",
      "rollback-casmeta",
    ]);
    expect(loaded.definition.finalChecks).not.toHaveLength(0);
  });

  it("has Docker image inputs and memcached workspace source", async () => {
    const loaded = await loadTask(taskFile, { cwd: taskDir });

    expect(loaded.definition.environment).toMatchObject({ dockerfile: "Dockerfile" });
    expect(loaded.definition.source).toMatchObject({ type: "fixture", path: "workspace" });
    await expect(stat(join(taskDir, "Dockerfile"))).resolves.toBeTruthy();
    await expect(stat(join(taskDir, "workspace", "README.md"))).resolves.toBeTruthy();
    await expect(stat(join(taskDir, "solution", "add-touch2.patch"))).resolves.toBeTruthy();
    await expect(stat(join(taskDir, "solution", "add-casmeta.patch"))).resolves.toBeTruthy();
    await expect(stat(join(taskDir, "solution", "rollback-casmeta.patch"))).resolves.toBeTruthy();
    await expect(readdir(join(taskDir, "workspace"))).resolves.not.toContain("tests");
  });

  it("step and final checks cover TOUCH2, CASMETA, rollback, and protocol docs", async () => {
    const loaded = await loadTask(taskFile, { cwd: taskDir });
    const allCommands = [
      ...loaded.definition.instructions.flatMap((step) => step.checks),
      ...loaded.definition.finalChecks,
    ]
      .map((check) => check.command.join(" "))
      .join("\n");
    const allChecks = [
      ...loaded.definition.instructions.flatMap((step) => step.checks),
      ...loaded.definition.finalChecks,
    ];

    expect(allCommands).toContain("touch2");
    expect(allCommands).toContain("casmeta");
    expect(allCommands).toContain("rollback");
    expect(allCommands).toContain("protocol");
    expect(allChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: expect.arrayContaining(["tsx"]),
          metadata: { runner: "host" },
        }),
      ]),
    );
  });

  it("step 1 check fails on baseline and passes with a known-good TOUCH2 change", async () => {
    const workspace = await copyBaseline();
    try {
      await expect(runCheck(workspace, "touch2.ts")).rejects.toThrow();
      await writeFile(join(workspace, "protocol_commands.txt"), "TOUCH\nGET\nSET\nTOUCH2\n");
      await writeFile(
        join(workspace, "doc", "protocol.txt"),
        "TOUCH2 updates expiration and returns the stored value with metadata.\n",
      );
      await writeFile(join(workspace, "src", "protocol.ts"), touch2OnlyProtocolSource);
      await expect(runCheck(workspace, "touch2.ts")).resolves.toBeTruthy();
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("step 1 check rejects placeholder command and documentation edits without behavior", async () => {
    const workspace = await copyBaseline();
    try {
      await writeFile(join(workspace, "protocol_commands.txt"), "TOUCH\nGET\nSET\nTOUCH2\n");
      await writeFile(
        join(workspace, "doc", "protocol.txt"),
        "TOUCH2 updates expiration and returns the stored value with metadata.\n",
      );
      await expect(runCheck(workspace, "touch2.ts")).rejects.toThrow();
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("step 2 check fails without CASMETA", async () => {
    const workspace = await copyBaseline();
    try {
      await expect(runCheck(workspace, "casmeta.ts")).rejects.toThrow();
      await writeFile(join(workspace, "src", "protocol.ts"), touch2AndCasmetaProtocolSource);
      await expect(runCheck(workspace, "casmeta.ts")).resolves.toBeTruthy();
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("final check fails if TOUCH2 is removed or CASMETA remains, and passes with final solution", async () => {
    const workspace = await copyBaseline();
    try {
      await writeFile(join(workspace, "protocol_commands.txt"), "TOUCH\nGET\nSET\nCASMETA\n");
      await expect(runCheck(workspace, "protocol.ts")).rejects.toThrow();

      await writeFile(
        join(workspace, "protocol_commands.txt"),
        "TOUCH\nGET\nSET\nTOUCH2\nCASMETA\n",
      );
      await writeFile(
        join(workspace, "doc", "protocol.txt"),
        "Protocol includes TOUCH2 and still includes CASMETA.\n",
      );
      await expect(runCheck(workspace, "protocol.ts")).rejects.toThrow();

      await writeFile(join(workspace, "protocol_commands.txt"), "TOUCH\nGET\nSET\nTOUCH2\n");
      await writeFile(
        join(workspace, "doc", "protocol.txt"),
        "Protocol includes TOUCH2 and omits rollback-only commands.\n",
      );
      await writeFile(join(workspace, "src", "protocol.ts"), touch2OnlyProtocolSource);
      await expect(runCheck(workspace, "protocol.ts")).resolves.toBeTruthy();
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("solution patches apply step-by-step and pass the corresponding checks", async () => {
    const workspace = await copyBaseline();
    try {
      await applySolutionPatch(workspace, "add-touch2");
      await expect(runCheck(workspace, "touch2.ts")).resolves.toBeTruthy();

      await applySolutionPatch(workspace, "add-casmeta");
      await expect(runCheck(workspace, "casmeta.ts")).resolves.toBeTruthy();

      await applySolutionPatch(workspace, "rollback-casmeta");
      await expect(runCheck(workspace, "rollback.ts")).resolves.toBeTruthy();
      await expect(runCheck(workspace, "protocol.ts")).resolves.toBeTruthy();
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
