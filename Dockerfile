FROM node:22-slim AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --frozen-lockfile

FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable && pnpm build

FROM node:22-slim AS runtime
LABEL io.modelcontextprotocol.server.name="io.github.rodrigoGA/sourcescout-mcp"
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    cloc \
    coreutils \
    findutils \
    git \
    gosu \
    grep \
    openssh-client \
    ripgrep \
    sed \
    sudo \
    tini \
    tree \
  && useradd --create-home --home-dir /home/sourcescout --shell /bin/sh sourcescout \
  && useradd --create-home --home-dir /home/sourcescout-readonly --shell /usr/sbin/nologin sourcescout-readonly \
  && printf 'sourcescout ALL=(sourcescout-readonly) NOPASSWD: /bin/sh\n' > /etc/sudoers.d/sourcescout-readonly \
  && chmod 0440 /etc/sudoers.d/sourcescout-readonly \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
ENV PATH=/app/node_modules/.bin:$PATH
COPY --chown=sourcescout:sourcescout package.json pnpm-lock.yaml* ./
COPY --from=deps --chown=sourcescout:sourcescout /app/node_modules ./node_modules
COPY --from=build --chown=sourcescout:sourcescout /app/dist ./dist
COPY --chown=sourcescout:sourcescout config/projects.example.yml /config/projects.yml
COPY docker/entrypoint.sh /usr/local/bin/sourcescout-entrypoint
RUN mkdir -p /workspace/repos /workspace/state \
  && chown -R sourcescout:sourcescout /workspace /config /home/sourcescout \
  && chown -R sourcescout-readonly:sourcescout-readonly /home/sourcescout-readonly \
  && chmod 0755 /workspace /workspace/repos \
  && chmod 0700 /workspace/state \
  && chmod +x /usr/local/bin/sourcescout-entrypoint
ENV PROJECTS_CONFIG_PATH=/config/projects.yml
EXPOSE 8080
ENTRYPOINT ["tini", "--", "sourcescout-entrypoint"]
CMD ["node", "dist/index.js"]
