import type {
  Harness,
  HarnessRunStepInput,
  HarnessStepOutput,
} from "@multibench/harness";
import { readFile } from "node:fs/promises";
import { ClaudeCodeHarness, type ClaudeCodeHarnessOptions } from "../claude-code/index.ts";

const promptPath = new URL("./cheat-prompt.md", import.meta.url);

export class ClaudeCodeCheaterHarness extends ClaudeCodeHarness {
  override readonly name = "claude-code-cheater";
  #prompt: string | undefined;

  override async runStep(input: HarnessRunStepInput): Promise<HarnessStepOutput> {
    const prompt = await this.#readPrompt();
    return super.runStep({
      ...input,
      step: {
        ...input.step,
        instruction: `${input.step.instruction.trim()}\n\n${prompt.trim()}`,
      },
    });
  }

  async #readPrompt(): Promise<string> {
    this.#prompt ??= await readFile(promptPath, "utf8");
    return this.#prompt;
  }
}

export function createClaudeCodeCheaterHarness(
  options: ClaudeCodeHarnessOptions = {},
): Harness {
  return new ClaudeCodeCheaterHarness(options);
}
