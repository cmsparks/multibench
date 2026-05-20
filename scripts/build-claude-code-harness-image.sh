#!/usr/bin/env sh
set -eu

CLAUDE_CODE_VERSION="${CLAUDE_CODE_VERSION:-latest}"
MULTIBENCH_TASK_BASE_IMAGE="${MULTIBENCH_TASK_BASE_IMAGE:-node:22-alpine}"
IMAGE_TAG="${IMAGE_TAG:-multibench-harness-claude-code:${CLAUDE_CODE_VERSION}}"

docker build \
  -f harnesses/claude-code/Dockerfile \
  --build-arg "CLAUDE_CODE_VERSION=${CLAUDE_CODE_VERSION}" \
  --build-arg "MULTIBENCH_TASK_BASE_IMAGE=${MULTIBENCH_TASK_BASE_IMAGE}" \
  -t "${IMAGE_TAG}" \
  .
