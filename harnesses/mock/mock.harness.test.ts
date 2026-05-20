import { describe, expect, it } from "vitest";
import harness from "./mock.harness.js";

describe("mock harness file", () => {
  it("works with runner-style step calls", async () => {
    await expect(
      harness.runStep({
        session: {
          attemptId: "attempt-001",
          taskId: "task",
          taskTitle: "Task",
          workspaceDir: "/workspace",
          containerWorkspaceDir: "/workspace",
          artifactsDir: "/artifacts",
          containerArtifactsDir: "/artifacts/harness",
          containerId: "container-001",
          taskDir: "/task",
          metadata: {},
        },
        step: { id: "first", index: 0, instruction: "Do it.", timeoutMs: 1000 },
      }),
    ).resolves.toMatchObject({ status: "completed" });
  });
});
