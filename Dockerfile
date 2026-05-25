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
  && apt-get install -y --no-install-recommends ca-certificates git gosu openssh-client ripgrep tini \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
ENV PATH=/app/node_modules/.bin:$PATH
COPY --chown=node:node package.json pnpm-lock.yaml* ./
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node config/projects.example.yml /config/projects.yml
COPY docker/entrypoint.sh /usr/local/bin/sourcescout-entrypoint
RUN mkdir -p /workspace/repos /workspace/state \
  && chown -R node:node /workspace /config \
  && chmod +x /usr/local/bin/sourcescout-entrypoint
ENV PROJECTS_CONFIG_PATH=/config/projects.yml
EXPOSE 8080
ENTRYPOINT ["tini", "--", "sourcescout-entrypoint"]
CMD ["node", "dist/index.js"]
