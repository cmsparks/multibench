import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function runHelloPython(): Promise<{ source: string; output: string[] }> {
  const workspaceDir = process.env.MULTIBENCH_WORKSPACE_DIR ?? process.cwd();
  const helloPath = join(workspaceDir, "hello.py");
  await access(helloPath);
  const source = await readFile(helloPath, "utf8");
  const result = await execFileAsync("python3", [helloPath], {
    cwd: workspaceDir,
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
  });
  const output = result.stdout
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
  return { source, output };
}

export function assertAllHelloWorld(output: string[], expectedCount: number): void {
  if (output.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} output lines, got ${output.length}`);
  }
  for (const line of output) {
    if (line !== "Hello world!") {
      throw new Error(`Expected "Hello world!", got ${JSON.stringify(line)}`);
    }
  }
}
