import { defineTask, dockerEnvironment, fixtureWorkspace, step } from "@multibench/tasks";
import { fileURLToPath } from "node:url";

const checkPath = (file: string) => fileURLToPath(new URL(`./checks/${file}`, import.meta.url));

export default defineTask({
  id: "memcached-command-rollback",
  title: "Memcached command rollback",
  source: fixtureWorkspace({ path: "workspace" }),
  environment: dockerEnvironment({ dockerfile: "Dockerfile" }),
  instructions: [
    step({
      id: "add-touch2",
      checks: [
        {
          id: "touch2-command",
          command: ["tsx", checkPath("touch2.ts")],
          metadata: { runner: "host" },
        },
      ],
    })`
      Add a TOUCH2 text protocol command to memcached. It should behave like TOUCH but return the item's value and metadata after updating expiration.
    `,
    step({
      id: "add-casmeta",
      checks: [
        {
          id: "casmeta-command",
          command: ["tsx", checkPath("casmeta.ts")],
          metadata: { runner: "host" },
        },
      ],
    })`
      Add a CASMETA text protocol command that updates CAS metadata for an existing item without changing the stored value.
    `,
    step({
      id: "rollback-casmeta",
      checks: [
        {
          id: "rollback-casmeta-only",
          command: ["tsx", checkPath("rollback.ts")],
          metadata: { runner: "host" },
        },
      ],
    })`
      Roll back only the CASMETA command. Keep TOUCH2 fully implemented and documented.
    `,
  ],
  finalChecks: [
    {
      id: "final-protocol-docs",
      command: ["tsx", checkPath("protocol.ts")],
      metadata: { runner: "host" },
    },
  ],
  metadata: {
    expectedProtocolCommands: ["TOUCH2"],
    rolledBackProtocolCommands: ["CASMETA"],
  },
});
