# development

## package manager

This repository uses pnpm workspaces.

The workspace enforces a minimum package release age of 7 days:

```yaml
minimumReleaseAge: 10080
```

`minimumReleaseAge` is measured in minutes.

## commands

```sh
pnpm install
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
```

## workspace packages

```text
packages/core
packages/tasks
packages/harness
packages/runner
packages/cli
```
