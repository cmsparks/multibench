import { assertIncludes, createProtocolFromWorkspace } from "./check-helpers.ts";

const protocol = await createProtocolFromWorkspace();

if (protocol.execute("SET alpha 7 60 hello") !== "STORED") {
  throw new Error("SET baseline command must store an item");
}

const response = protocol.execute("TOUCH2 alpha 120");
assertIncludes(response, "VALUE alpha 7 5");
assertIncludes(response, "hello");
assertIncludes(response, "EXPTIME 120");
assertIncludes(response, "END");

if (protocol.execute("TOUCH2 missing 120") !== "NOT_FOUND") {
  throw new Error("TOUCH2 must return NOT_FOUND for missing items");
}

assertIncludes(protocol.execute("GET alpha"), "hello");
