import { parseWithSchema } from "./schema/parse.js";
import { SuiteRunResultSchema } from "./schema/results.js";
import { NormalizedTaskDefinitionSchema } from "./schema/task.js";

export const corePackageName = "@multibench/core";

export * from "./status.js";
export * from "./types/checks.js";
export * from "./types/harness.js";
export * from "./types/task.js";
export * from "./scoring/types.js";
export * from "./results/types.js";

export * from "./schema/checks.js";
export * from "./schema/common.js";
export * from "./schema/harness.js";
export * from "./schema/parse.js";
export * from "./schema/results.js";
export * from "./schema/scoring.js";
export * from "./schema/task.js";

export { parseWithSchema as parseSchema } from "./schema/parse.js";

export function parseNormalizedTaskDefinition(value: unknown) {
  return parseWithSchema(NormalizedTaskDefinitionSchema, value, "normalized task definition");
}

export function parseSuiteRunResult(value: unknown) {
  return parseWithSchema(SuiteRunResultSchema, value, "suite run result");
}
