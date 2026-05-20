import { assertAllHelloWorld, runHelloPython } from "./check-helpers.ts";

const { output } = await runHelloPython();
assertAllHelloWorld(output, 1);
