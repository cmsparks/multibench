import { assertAllHelloWorld, runHelloPython } from "./check-helpers.ts";

const { source, output } = await runHelloPython();
assertAllHelloWorld(output, 5);

if (!/\bfor\b|\bwhile\b/.test(source)) {
  throw new Error("hello.py must use a loop");
}
