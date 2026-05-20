import { assertIncludes, createProtocolFromWorkspace } from "./check-helpers.ts";

const protocol = await createProtocolFromWorkspace();

if (protocol.execute("SET gamma 9 30 value") !== "STORED") {
  throw new Error("SET baseline command must store an item");
}

const touch2 = protocol.execute("TOUCH2 gamma 300");
assertIncludes(touch2, "VALUE gamma 9 5");
assertIncludes(touch2, "value");
assertIncludes(touch2, "EXPTIME 300");

if (protocol.execute("CASMETA gamma 77") !== "ERROR") {
  throw new Error("CASMETA must be rolled back and unavailable");
}
