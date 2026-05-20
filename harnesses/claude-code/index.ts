import type {
  Harness,
  HarnessEvent,
  HarnessRunStepInput,
  HarnessStepOutput,
} from "@multibench/harness";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ClaudeCodeOptions = {
  api_key: string;
  model: string;
  max_turns?: number;
  claude_code_version?: string;
  env?: Record<string, string>;
};

export type ClaudeCodeExecuteResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type ClaudeCodeHarnessOptions = {
  execute?: (command: string) => Promise<ClaudeCodeExecuteResult>;
};

type ParsedClaudeOutput = HarnessStepOutput & {
  claudeSessionId?: string;
};

export class ClaudeCodeHarness implements Harness {
  readonly name = "claude-code";
  #config: ClaudeCodeOptions | undefined;
  readonly #execute: (command: string) => Promise<ClaudeCodeExecuteResult>;

  constructor(options: ClaudeCodeHarnessOptions = {}) {
    this.#execute = options.execute ?? this.#defaultExecute;
  }

  async configure(rawOptions: unknown): Promise<void> {
    this.#config = this.#validateOptions(rawOptions);
  }

  dockerImageLayer(input: { baseImage: string }) {
    const config = this.#requireConfig();
    return {
      dockerfile: new URL("./Dockerfile", import.meta.url).pathname,
      context: new URL(".", import.meta.url).pathname,
      tagPrefix: "multibench-harness-claude-code",
      buildArgs: {
        CLAUDE_CODE_VERSION: config.claude_code_version ?? "latest",
        MULTIBENCH_TASK_BASE_IMAGE: input.baseImage,
      },
    };
  }

  async runStep(input: HarnessRunStepInput): Promise<HarnessStepOutput> {
    const config = this.#requireConfig();
    const command = this.#buildCommand(input, config);
    const result = await this.#execute(command);
    await this.#writeRawArtifacts(input, result);

    const output = this.#parseStreamJson(result.stdout);
    return {
      ...output,
      status: result.exitCode === 0 ? output.status : "failed",
    };
  }

  #requireConfig(): ClaudeCodeOptions {
    if (!this.#config) {
      throw new Error("Claude Code harness must be configured before runStep");
    }

    return this.#config;
  }

  #validateOptions(value: unknown): ClaudeCodeOptions {
    if (typeof value !== "object" || value === null) {
      throw new Error("Claude Code options must be an object");
    }

    const options = value as Record<string, unknown>;
    if (typeof options.api_key !== "string" || options.api_key.trim() === "") {
      throw new Error("Claude Code option api_key is required");
    }
    if (typeof options.model !== "string" || options.model.trim() === "") {
      throw new Error("Claude Code option model is required");
    }
    if (options.permission_mode !== undefined) {
      throw new Error(
        "Claude Code option permission_mode is fixed to bypassPermissions",
      );
    }
    if (
      options.max_turns !== undefined &&
      (!Number.isInteger(options.max_turns) || Number(options.max_turns) < 1)
    ) {
      throw new Error("Claude Code option max_turns must be a positive integer");
    }
    if (
      options.claude_code_version !== undefined &&
      (typeof options.claude_code_version !== "string" || options.claude_code_version.trim() === "")
    ) {
      throw new Error("Claude Code option claude_code_version must be a non-empty string");
    }

    return {
      api_key: options.api_key,
      model: options.model,
      max_turns: options.max_turns as number | undefined,
      claude_code_version: options.claude_code_version as string | undefined,
      env: this.#validateEnv(options.env),
    };
  }

  #validateEnv(value: unknown): Record<string, string> | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("Claude Code option env must be an object of string values");
    }

    const env: Record<string, string> = {};
    for (const [key, envValue] of Object.entries(value)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        throw new Error(`Claude Code env key is invalid: ${key}`);
      }
      if (typeof envValue !== "string") {
        throw new Error(`Claude Code env value for ${key} must be a string`);
      }
      env[key] = envValue;
    }

    return env;
  }

  #buildCommand(input: HarnessRunStepInput, options: ClaudeCodeOptions): string {
    const args = [
      "docker",
      "exec",
      "-e",
      `ANTHROPIC_API_KEY=${this.#shellQuote(options.api_key)}`,
      "-e",
      "IS_SANDBOX=1",
    ];

    for (const [key, value] of Object.entries(options.env ?? {})) {
      args.push("-e", `${key}=${this.#shellQuote(value)}`);
    }

    args.push(
      "-w",
      this.#shellQuote(input.session.containerWorkspaceDir),
      this.#shellQuote(input.session.containerId),
      "claude",
      "--print",
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      this.#shellQuote(options.model),
      "--permission-mode",
      "bypassPermissions",
    );

    if (options.max_turns) {
      args.push("--max-turns", String(options.max_turns));
    }

    const priorSessionId = this.#priorClaudeSessionId(input.session.harnessState);
    if (priorSessionId) {
      args.push("--resume", this.#shellQuote(priorSessionId));
    }

    args.push(this.#shellQuote(input.step.instruction));
    return args.join(" ");
  }

  async #writeRawArtifacts(
    input: HarnessRunStepInput,
    result: ClaudeCodeExecuteResult,
  ): Promise<void> {
    const stepArtifactDir = join(input.session.artifactsDir, "steps", input.step.id);
    await mkdir(stepArtifactDir, { recursive: true });
    await writeFile(join(stepArtifactDir, "raw-output.jsonl"), result.stdout, "utf8");
    await writeFile(join(stepArtifactDir, "stderr.log"), result.stderr, "utf8");
  }

  #parseStreamJson(output: string): ParsedClaudeOutput {
    const events: HarnessEvent[] = [];
    let status: HarnessStepOutput["status"] = "completed";
    let claudeSessionId: string | undefined;

    for (const line of output.split(/\r?\n/)) {
      if (line.trim() === "") {
        continue;
      }

      const event = JSON.parse(line) as Record<string, unknown>;
      if (typeof event.session_id === "string") {
        claudeSessionId = event.session_id;
      }

      if (event.type === "assistant") {
        const text = this.#extractAssistantText(event);
        if (text) {
          events.push({ type: "assistant-message", time: new Date().toISOString(), text });
        }
      } else if (event.type === "result" && event.subtype && event.subtype !== "success") {
        status = "failed";
      } else {
        events.push({ type: "native", time: new Date().toISOString(), data: event });
      }
    }

    return {
      status,
      events,
      nextHarnessState: claudeSessionId ? { claudeSessionId } : undefined,
      claudeSessionId,
    };
  }

  async #defaultExecute(command: string): Promise<ClaudeCodeExecuteResult> {
    try {
      const result = await execFileAsync("sh", ["-lc", command], { maxBuffer: 10 * 1024 * 1024 });
      return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException & {
        stdout?: string;
        stderr?: string;
        code?: number | string;
      };
      return {
        stdout: nodeError.stdout ?? "",
        stderr: nodeError.stderr ?? "",
        exitCode: typeof nodeError.code === "number" ? nodeError.code : 1,
      };
    }
  }

  #priorClaudeSessionId(value: unknown): string | undefined {
    if (typeof value === "object" && value !== null && "claudeSessionId" in value) {
      const id = (value as { claudeSessionId?: unknown }).claudeSessionId;
      return typeof id === "string" ? id : undefined;
    }

    return undefined;
  }

  #extractAssistantText(event: Record<string, unknown>): string | undefined {
    const message = event.message as { content?: unknown } | undefined;
    if (!Array.isArray(message?.content)) {
      return undefined;
    }

    return message.content
      .map((part) =>
        typeof part === "object" &&
        part !== null &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : "",
      )
      .filter(Boolean)
      .join("\n");
  }

  #shellQuote(value: string): string {
    if (/^[A-Za-z0-9_./:=@-]+$/.test(value)) {
      return value;
    }

    return `'${value.replaceAll("'", "'\\''")}'`;
  }
}

export function createClaudeCodeHarness(options: ClaudeCodeHarnessOptions = {}): Harness {
  return new ClaudeCodeHarness(options);
}
