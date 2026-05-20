import { defineTask, dockerEnvironment, fixtureWorkspace, step } from "@multibench/tasks";
import { fileURLToPath } from "node:url";

const checkPath = (file: string) => fileURLToPath(new URL(`./checks/${file}`, import.meta.url));

export default defineTask({
  id: "hello-world-python",
  title: "Hello world Python",
  source: fixtureWorkspace({ path: "workspace" }),
  environment: dockerEnvironment({ dockerfile: "Dockerfile" }),
  instructions: [
    step({
      id: "write-hello-world",
      checks: [
        {
          id: "hello-world-output",
          command: ["tsx", checkPath("hello.ts")],
          metadata: { runner: "host" },
        },
      ],
    })`
      Write a Python file that prints exactly "Hello world!".
    `,
    step({
      id: "loop-five-times",
      checks: [
        {
          id: "hello-world-loop",
          command: ["tsx", checkPath("loop.ts")],
          metadata: { runner: "host" },
        },
      ],
    })`
      Update the Python file so it outputs "Hello world!" five times in a loop.
    `,
  ],
});
