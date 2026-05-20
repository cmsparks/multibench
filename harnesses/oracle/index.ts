import type {
  Harness,
  HarnessRunStepInput,
  HarnessStepOutput,
} from "@multibench/harness";
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type OracleHarnessOptions = {
  solutionDir?: string;
};

export class OracleHarness implements Harness {
  readonly name = "oracle";
  #solutionDir: string | undefined;

  constructor(options: OracleHarnessOptions = {}) {
    this.#solutionDir = options.solutionDir;
  }

  configure(options: unknown): void {
    if (options === undefined) {
      return;
    }
    if (typeof options !== "object" || options === null) {
      throw new Error("Oracle harness options must be an object");
    }
    const rawOptions = options as Record<string, unknown>;
    if (rawOptions.solution_dir !== undefined && typeof rawOptions.solution_dir !== "string") {
      throw new Error("Oracle harness option solution_dir must be a string");
    }
    if (rawOptions.solutionDir !== undefined && typeof rawOptions.solutionDir !== "string") {
      throw new Error("Oracle harness option solutionDir must be a string");
    }
    this.#solutionDir = (rawOptions.solution_dir ?? rawOptions.solutionDir) as string | undefined;
  }

  async runStep(input: HarnessRunStepInput): Promise<HarnessStepOutput> {
    const patchPath = this.#patchPath(input);
    try {
      await access(patchPath);
      const result = await execFileAsync("git", ["apply", "--recount", "--whitespace=nowarn", patchPath], {
        cwd: input.session.workspaceDir,
        env: {
          ...process.env,
          GIT_CEILING_DIRECTORIES: dirname(input.session.workspaceDir),
        },
        maxBuffer: 10 * 1024 * 1024,
      });
      return {
        status: "completed",
        events: [
          {
            type: "native",
            time: new Date().toISOString(),
            data: {
              patchPath,
              stdout: result.stdout,
              stderr: result.stderr,
            },
          },
        ],
      };
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException & {
        stdout?: string;
        stderr?: string;
      };
      return {
        status: "failed",
        message: `Failed to apply oracle solution patch ${patchPath}: ${nodeError.message}`,
        error: {
          name: nodeError.name,
          message: nodeError.message,
          stack: nodeError.stack,
        },
        events: [
          {
            type: "native",
            time: new Date().toISOString(),
            data: {
              patchPath,
              stdout: nodeError.stdout ?? "",
              stderr: nodeError.stderr ?? "",
            },
          },
        ],
      };
    }
  }

  #patchPath(input: HarnessRunStepInput): string {
    const solutionDir = this.#solutionDir
      ? resolve(input.session.taskDir, this.#solutionDir)
      : join(input.session.taskDir, "solution");
    return join(solutionDir, `${input.step.id}.patch`);
  }
}

export function createOracleHarness(options: OracleHarnessOptions = {}): Harness {
  return new OracleHarness(options);
}
