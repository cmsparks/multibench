import { pathToFileURL } from "node:url";
import { join } from "node:path";

export type Protocol = {
  execute(input: string): string;
};

export async function createProtocolFromWorkspace(): Promise<Protocol> {
  const workspaceDir = process.env.MULTIBENCH_WORKSPACE_DIR ?? process.cwd();
  const moduleUrl = pathToFileURL(join(workspaceDir, "src", "protocol.ts")).href;
  const module = (await import(`${moduleUrl}?t=${Date.now()}`)) as {
    createProtocol?: unknown;
  };

  if (typeof module.createProtocol !== "function") {
    throw new Error("src/protocol.ts must export createProtocol()");
  }

  const protocol = module.createProtocol() as unknown;
  if (
    typeof protocol !== "object" ||
    protocol === null ||
    typeof (protocol as { execute?: unknown }).execute !== "function"
  ) {
    throw new Error("createProtocol() must return an object with execute(input)");
  }

  return protocol as Protocol;
}

export function assertIncludes(value: string, expected: string): void {
  if (!value.includes(expected)) {
    throw new Error(`Expected ${JSON.stringify(value)} to include ${JSON.stringify(expected)}`);
  }
}

export function assertNotIncludes(value: string, expected: string): void {
  if (value.includes(expected)) {
    throw new Error(`Expected ${JSON.stringify(value)} not to include ${JSON.stringify(expected)}`);
  }
}
