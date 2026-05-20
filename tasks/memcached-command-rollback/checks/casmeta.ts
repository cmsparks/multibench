import { assertIncludes, createProtocolFromWorkspace } from "./check-helpers.ts";

const protocol = await createProtocolFromWorkspace();

if (protocol.execute("SET beta 3 90 world") !== "STORED") {
  throw new Error("SET baseline command must store an item");
}

const before = protocol.execute("META beta");
assertIncludes(before, "cas=1");
assertIncludes(before, "bytes=5");

if (protocol.execute("CASMETA beta 44") !== "UPDATED") {
  throw new Error("CASMETA must update CAS metadata for an existing item");
}

const after = protocol.execute("META beta");
assertIncludes(after, "cas=44");
assertIncludes(after, "bytes=5");
assertIncludes(protocol.execute("GET beta"), "world");

if (protocol.execute("CASMETA missing 44") !== "NOT_FOUND") {
  throw new Error("CASMETA must return NOT_FOUND for missing items");
}
