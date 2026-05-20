ARG MULTIBENCH_TASK_BASE_IMAGE
FROM ${MULTIBENCH_TASK_BASE_IMAGE}

ARG CLAUDE_CODE_VERSION=latest
RUN if command -v apk >/dev/null 2>&1; then \
      apk add --no-cache bash curl; \
    elif command -v apt-get >/dev/null 2>&1; then \
      apt-get update && apt-get install -y --no-install-recommends bash curl && rm -rf /var/lib/apt/lists/*; \
    fi
RUN bash -lc 'set -euo pipefail; curl -fsSL https://claude.ai/install.sh | bash -s -- "${CLAUDE_CODE_VERSION}"'

ENV PATH="/root/.local/bin:${PATH}"
ENV IS_SANDBOX=1
RUN claude --version
