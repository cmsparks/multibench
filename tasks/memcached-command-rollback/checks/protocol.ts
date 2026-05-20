import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertIncludes, createProtocolFromWorkspace } from "./check-helpers.ts";

const workspaceDir = process.env.MULTIBENCH_WORKSPACE_DIR ?? process.cwd();
const protocolCommands = readFileSync(join(workspaceDir, "protocol_commands.txt"), "utf8");
const protocolDocs = readFileSync(join(workspaceDir, "doc", "protocol.txt"), "utf8");
const commands = new Set(protocolCommands.split(/\s+/).filter(Boolean));

for (const command of ["TOUCH", "GET", "SET", "TOUCH2"]) {
  if (!commands.has(command)) {
    throw new Error(`protocol_commands.txt must list ${command}`);
  }
}

if (commands.has("CASMETA")) {
  throw new Error("protocol_commands.txt must not list rolled-back CASMETA");
}

if (!/\bTOUCH2\b/.test(protocolDocs)) {
  throw new Error("doc/protocol.txt must document TOUCH2");
}

if (/\bCASMETA\b/.test(protocolDocs)) {
  throw new Error("doc/protocol.txt must not document rolled-back CASMETA");
}

const protocol = await createProtocolFromWorkspace();
if (protocol.execute("SET final 4 10 data") !== "STORED") {
  throw new Error("SET baseline command must store an item");
}

const touch2 = protocol.execute("TOUCH2 final 20");
assertIncludes(touch2, "VALUE final 4 4");
assertIncludes(touch2, "data");
assertIncludes(touch2, "EXPTIME 20");

if (protocol.execute("CASMETA final 99") !== "ERROR") {
  throw new Error("CASMETA must not remain available in the final solution");
}
