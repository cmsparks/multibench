import { describe, expect, it } from "vitest";
import { parseNormalizedTaskDefinition, type NormalizedTaskDefinition } from "@multibench/core";
import { defineTask, dockerEnvironment, step } from "./index.js";

describe("task authoring API", () => {
  it("step(...) deindents multiline template text", () => {
    const instruction = step({ id: "update-readme" })`
      Update the README with install instructions.
        Keep the existing heading structure.
      Add a short usage example.
    `;

    expect(instruction.instruction).toBe(
      [
        "Update the README with install instructions.",
        "  Keep the existing heading structure.",
        "Add a short usage example.",
      ].join("\n"),
    );
  });

  it("step(...) trims leading and trailing blank lines after deindent", () => {
    const instruction = step({ id: "trimmed-step" })`

      Add validation for empty usernames.

      Preserve the existing public API.

    `;

    expect(instruction.instruction).toBe(
      "Add validation for empty usernames.\n\nPreserve the existing public API.",
    );
  });

  it("step(...) rejects interpolation in template text", () => {
    const dynamicText = "dynamic instruction";

    expect(() => step({ id: "static-only" })`Do not include ${dynamicText}.`).toThrow(
      /interpolation/i,
    );
  });

  it("omitted checks default to tests/<id>.test.ts", () => {
    const task = defineTask({
      id: "default-check-task",
      title: "Default check task",
      source: { type: "fixture", path: "fixture" },
      environment: { dockerfile: "Dockerfile" },
      instructions: [
        step({ id: "add-parser" })`
          Add the parser.
        `,
      ],
    });

    expect(task.instructions[0]?.checks).toEqual([
      {
        id: "add-parser",
        command: ["vitest", "run", "tests/add-parser.test.ts"],
      },
    ]);
    expect(task.checks).toEqual(task.instructions[0]?.checks);
  });

  it("explicit checks are preserved", () => {
    const task = defineTask({
      id: "explicit-check-task",
      title: "Explicit check task",
      source: { type: "fixture", path: "fixture" },
      environment: { dockerfile: "Dockerfile" },
      instructions: [
        step({
          id: "add-retry",
          checks: [
            "tests/retry.test.ts",
            {
              id: "retry-integration",
              command: ["pnpm", "vitest", "run", "tests/retry.integration.test.ts"],
              cwd: "workspace",
              timeoutMs: 30_000,
              env: { NODE_ENV: "test" },
            },
          ],
        })`
          Add retry behavior.
        `,
      ],
    });

    expect(task.instructions[0]?.checks).toEqual([
      {
        id: "add-retry",
        command: ["vitest", "run", "tests/retry.test.ts"],
      },
      {
        id: "retry-integration",
        command: ["pnpm", "vitest", "run", "tests/retry.integration.test.ts"],
        cwd: "workspace",
        timeoutMs: 30_000,
        env: { NODE_ENV: "test" },
      },
    ]);
  });

  it("defineTask(...) derives instruction count and normalized indexes from steps", () => {
    const task = defineTask({
      id: "multi-step-task",
      title: "Multi-step task",
      style: ["selective-undo"],
      source: { type: "fixture", path: "fixture" },
      environment: { dockerfile: "Dockerfile" },
      instructions: [
        step({ id: "first-step" })`
          Do the first thing.
        `,
        step({ id: "second-step" })`
          Do the second thing.
        `,
        step({ id: "third-step" })`
          Do the third thing.
        `,
      ],
    });

    expect(task.instructions).toHaveLength(3);
    expect(task.instructions.map((instruction) => instruction.index)).toEqual([0, 1, 2]);
    expect(task.instructions.map((instruction) => instruction.id)).toEqual([
      "first-step",
      "second-step",
      "third-step",
    ]);
  });

  it("duplicate step ids fail validation", () => {
    expect(() =>
      defineTask({
        id: "duplicate-step-task",
        title: "Duplicate step task",
        source: { type: "fixture", path: "fixture" },
        environment: { dockerfile: "Dockerfile" },
        instructions: [
          step({ id: "same-step" })`
            Do the first thing.
          `,
          step({ id: "same-step" })`
            Do the second thing.
          `,
        ],
      }),
    ).toThrow(/duplicate step id "same-step"/i);
  });

  it("task without Docker environment fails validation", () => {
    expect(() =>
      defineTask({
        id: "missing-environment-task",
        title: "Missing environment task",
        source: { type: "fixture", path: "fixture" },
        instructions: [
          step({ id: "first-step" })`
            Do the first thing.
          `,
        ],
      }),
    ).toThrow(/environment/i);
  });

  it('task with dockerEnvironment({ dockerfile: "Dockerfile" }) passes', () => {
    const task = defineTask({
      id: "dockerfile-task",
      title: "Dockerfile task",
      source: { type: "fixture", path: "fixture" },
      environment: dockerEnvironment({ dockerfile: "Dockerfile" }),
      instructions: [
        step({ id: "first-step" })`
          Do the first thing.
        `,
      ],
    });

    expect(parseNormalizedTaskDefinition(task)).toEqual(task);
    expect(task.environment).toEqual({ dockerfile: "Dockerfile" });
  });

  it("normalizes task definitions into core-compatible values", () => {
    const task = defineTask({
      id: "core-compatible-task",
      title: "Core compatible task",
      style: ["large-codebase"],
      source: { type: "fixture", path: "fixture" },
      environment: { dockerfile: "Dockerfile" },
      finalChecks: [{ id: "final", command: ["vitest", "run", "tests/final.test.ts"] }],
      metadata: { owner: "tasks-package" },
      instructions: [
        step({ id: "first-step" })`
          Do the first thing.
        `,
      ],
    });

    const parsed: NormalizedTaskDefinition = parseNormalizedTaskDefinition(task);

    expect(parsed).toMatchObject({
      id: "core-compatible-task",
      title: "Core compatible task",
      style: ["large-codebase"],
      source: { type: "fixture", path: "fixture" },
      environment: { dockerfile: "Dockerfile" },
      finalChecks: [{ id: "final", command: ["vitest", "run", "tests/final.test.ts"] }],
      metadata: { owner: "tasks-package" },
    });
    expect(parsed.instructions[0]).toMatchObject({
      id: "first-step",
      index: 0,
      instruction: "Do the first thing.",
      checks: [{ id: "first-step", command: ["vitest", "run", "tests/first-step.test.ts"] }],
    });
  });
});
