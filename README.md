# SourceScout MCP

SourceScout MCP is a small, professional MCP server that lets an LLM answer questions about code across multiple Git projects.

It is designed for teams that want useful code intelligence without building an indexing pipeline: no database, no Redis, no vector store, no embedding service, and no mandatory background index. SourceScout keeps local checkouts fresh, runs Probe and Git on demand, and exposes a compact set of read-only MCP tools over HTTP.

## Why SourceScout?

Modern coding agents already know how to reason about code, but they need the right retrieval tools. Plain grep returns line fragments. Vector search requires indexing and can split code in awkward chunks. Probe takes a better path for agents: AST-aware code search, ranked results, complete code blocks, token budgets, and local execution.

SourceScout builds on that idea and adds the operational layer for real repositories:

- **Multi-project registry**: expose backend, frontend, workers, libraries, and legacy repos through one MCP.
- **No indexing required**: clone or mount repos and query them immediately.
- **Local and private**: code stays in your infrastructure; tools run inside the container.
- **LLM-friendly context**: Probe search/extract/query, grep, file reads, symbol listing, and Git history.
- **Git-provider agnostic**: works with GitHub, GitLab, Bitbucket, Gitea, and plain SSH/HTTPS remotes.
- **Simple operations**: YAML config, Docker image, health checks, bearer auth, and Kubernetes-ready deployment.

SourceScout is fast to start and easy to operate: for small teams it can run as a tiny HTTP service, and for larger codebases it can keep a persistent workspace volume warm and wake on demand with scale-to-zero setups such as KEDA. It is ready to use as soon as the repos are available.

SourceScout is intentionally read-only. It is meant for agents that investigate, explain, review, onboard, and plan changes before any editor or CI system mutates code.

## MCP Tools

SourceScout exposes these tools when enabled in config:

- `list_projects`: list configured projects and their sync status.
- `project_overview`: return a compact map of a repo: top-level paths, file count, common extensions, current head.
- `search_code`: Probe semantic search with ElasticSearch-style queries and ranked code snippets.
- `query_code`: Probe AST/structural query for precise code shapes.
- `extract_code`: Probe extraction for complete code blocks by `file:line`, `file:line-line`, or `file#symbol`.
- `list_symbols`: Probe symbol table for files with line numbers and nesting.
- `grep`: grep-style search for logs, config, text, and other non-code files.
- `read_file`: numbered line-range reads with size and line caps.
- `list_files`: tracked files with optional path/glob filtering.
- `git_query`: read-only Git operations.

`git_query` supports:

- `log`
- `show_commit`
- `diff`
- `changed_files`
- `tags`
- `branches`
- `blame`
- `search_history_text`
- `search_history_regex`
- `show_file_at_revision`

## Configuration Model

Start from `config/projects.local.example.yml` for local development or `config/projects.example.yml` for Docker/Kubernetes.

```yaml
server:
  name: SourceScout MCP
  port: 8080

workspace:
  root: /workspace/repos
  state_path: /workspace/state
  clone_on_startup: true
  pull_on_startup: true
  pull_ttl_seconds: 300
  sync_timeout_seconds: 600
  reclone_on_sync_failure: true

auth:
  enabled: true
  type: bearer
  token_env: CODE_MCP_TOKEN

projects:
  - id: backend
    name: Backend API
    repo_url: git@gitlab.example.com:org/backend.git
    branch: main
    enabled: true

  - id: local-lib
    name: Local Library
    local_path: /workspace/mounted/local-lib
    branch: main
    enabled: true
```

Use `repo_url` for SourceScout-managed clones. Use `local_path` for mounted repos. SourceScout never deletes a configured `local_path`; `reclone_on_sync_failure` only applies to managed clones under `workspace.root`.

### Probe Results and Pagination

Probe does not use offset/page pagination. For `search_code`, SourceScout exposes Probe's `session` parameter so repeated searches can avoid returning results already shown in that session. For other Probe tools, use narrower follow-up calls or extract exact blocks from previous results.

For deeper exploration, agents should issue narrower or follow-up queries, use `extract_code` for exact blocks, or use `grep`/`read_file` for deterministic expansion.

### Limits

The config separates command settings from hard caps:

- `probe`: Probe binary setting.
- `git`: Git-specific defaults, currently `timeout_seconds` and `default_log_limit`.
- `limits`: global safety caps across tools.

Recommended defaults are intentionally generous for large repositories and generated source files:

```yaml
limits:
  max_file_lines: 60000
  max_file_bytes: 5000000
  max_tool_output_bytes: 8000000
  max_search_results: 100
  max_git_log_limit: 200
  command_timeout_seconds: 300
```

`max_file_lines` and `max_file_bytes` are large enough for unusually large generated files, while still preventing accidental unbounded reads.


## Docker

Published image:

```bash
docker pull rogo16/sourcescout-mcp:v0.0.1
```

```bash
docker run --rm -p 8080:8080 \
  -v "$PWD/config/projects.example.yml:/config/projects.yml:ro" \
  -v "$PWD/workspace:/workspace" \
  -e PROJECTS_CONFIG_PATH=/config/projects.yml \
  rogo16/sourcescout-mcp:v0.0.1
```

The image includes Node 22, Probe, Git, OpenSSH client, CA certificates, ripgrep, and tini.

## Kubernetes

Use:

- a `ConfigMap` for `projects.yml`
- a `Secret` for `CODE_MCP_TOKEN`
- a `Secret` for the SSH deploy key
- a persistent volume mounted at `/workspace`

The image uses OpenSSH `StrictHostKeyChecking=accept-new` by default and stores `known_hosts` in `/workspace/state/known_hosts`, so the baseline Kubernetes manifest does not need an initContainer or a `known_hosts` Secret. For stricter host-key pinning, override `GIT_SSH_COMMAND` and mount a curated `known_hosts` file.

Keep `/live` and `/ready` unauthenticated for platform probes. Protect `/mcp` with bearer auth in non-local deployments.

See [docs/kubernetes.md](docs/kubernetes.md) for a complete baseline manifest.


## Claude / Agent Integration

### Claude Code HTTP

Run SourceScout:

```bash
docker run --rm -p 8080:8080 \
  -v "$PWD/config/projects.example.yml:/config/projects.yml:ro" \
  -v "$PWD/workspace:/workspace" \
  -e PROJECTS_CONFIG_PATH=/config/projects.yml \
  -e CODE_MCP_TOKEN=change-me \
  rogo16/sourcescout-mcp:v0.0.1
```

Add it to Claude Code:

```bash
claude mcp add --transport http sourcescout http://localhost:8080/mcp \
  --header "Authorization: Bearer change-me"
```

Equivalent JSON:

```json
{
  "mcpServers": {
    "sourcescout": {
      "type": "http",
      "url": "http://localhost:8080/mcp",
      "headers": {
        "Authorization": "Bearer change-me"
      }
    }
  }
}
```

### Claude Desktop

If your Claude Desktop build does not connect directly to local HTTP MCP servers, use a stdio bridge such as `mcp-remote`:

```json
{
  "mcpServers": {
    "sourcescout": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "http://localhost:8080/mcp",
        "--header",
        "Authorization: Bearer change-me"
      ]
    }
  }
}
```

Keep the SourceScout Docker container running separately.

## Running Locally

```bash
pnpm install
pnpm build
PROJECTS_CONFIG_PATH=./config/projects.local.example.yml pnpm start
```

Endpoints:

- `POST /mcp`: MCP Streamable HTTP endpoint.
- `GET /live`: process liveness.
- `GET /ready`: readiness based on project sync status.
- `GET /health`: diagnostics for Probe, Git, and projects.

## Repository Configuration Examples

SourceScout receives normal Git clone URLs. Use the same protocol you would use from a CI job or read-only automation account. For private repositories, generate credentials with the minimum read-only access needed to clone and fetch the repository.

Recommended order:

- **SSH deploy key** for private repos when your provider supports it.
- **HTTPS token via `.netrc`** when SSH is not practical.
- **Token in the URL** only for local experiments or short-lived automation, because Git can persist the remote URL inside `.git/config`.

### Public HTTPS Repository

No credentials are required.

```yaml
projects:
  - id: probe
    name: Probe
    repo_url: https://github.com/probelabs/probe.git
    branch: main
    enabled: true
```

### Private Repository With SSH Deploy Key

Prefer a read-only deploy key or a read-only machine-user SSH key.

```yaml
projects:
  - id: backend
    name: Backend API
    repo_url: git@gitlab.example.com:org/backend.git
    branch: main
    enabled: true

  - id: service
    name: GitHub Service
    repo_url: git@github.com:company/service.git
    branch: main
    enabled: true
```

Docker example:

```bash
docker run --rm -p 8080:8080 \
  -v "$PWD/config/projects.yml:/config/projects.yml:ro" \
  -v "$PWD/workspace:/workspace" \
  -v "$PWD/secrets/id_ed25519:/run/secrets/sourcescout/id_ed25519:ro" \
  -e CODE_MCP_TOKEN=change-me \
  rogo16/sourcescout-mcp:v0.0.1
```

The image copies the key into `/home/node/.ssh/id_ed25519`, fixes permissions, and uses `StrictHostKeyChecking=accept-new` with `/workspace/state/known_hosts`.

### Private Repository With HTTPS Token

Use `.netrc` when you want HTTPS credentials without putting tokens in `projects.yml`.

```yaml
projects:
  - id: github-private
    name: GitHub Private Repo
    repo_url: https://github.com/company/private-repo.git
    branch: main
    enabled: true

  - id: gitlab-private
    name: GitLab Private Repo
    repo_url: https://gitlab.example.com/org/private-repo.git
    branch: main
    enabled: true
```

Example `.netrc`:

```netrc
machine github.com
  login YOUR_GITHUB_USERNAME
  password YOUR_GITHUB_FINE_GRAINED_PAT

machine gitlab.example.com
  login YOUR_GITLAB_DEPLOY_TOKEN_USERNAME
  password YOUR_GITLAB_DEPLOY_TOKEN

machine bitbucket.org
  login YOUR_BITBUCKET_USERNAME
  password YOUR_BITBUCKET_APP_PASSWORD_OR_API_TOKEN

machine gitea.example.com
  login YOUR_GITEA_USERNAME
  password YOUR_GITEA_TOKEN
```

Docker example:

```bash
docker run --rm -p 8080:8080 \
  -v "$PWD/config/projects.yml:/config/projects.yml:ro" \
  -v "$PWD/workspace:/workspace" \
  -v "$PWD/secrets/netrc:/run/secrets/sourcescout/netrc:ro" \
  -e CODE_MCP_TOKEN=change-me \
  rogo16/sourcescout-mcp:v0.0.1
```

Token guidance:

- GitHub: use a fine-grained personal access token scoped to the selected repositories with read-only Contents access.
- GitLab: prefer a deploy token or project/group access token with `read_repository`.
- Bitbucket Cloud: use an app password or API token with repository read access.
- Gitea/Forgejo: use a token or service account with repository read access.

### HTTPS Token In URL

This is simple but less clean because the token can be stored in the cloned repo's Git remote config.

```yaml
projects:
  - id: gitlab-token-url
    name: GitLab Token URL
    repo_url: https://deploy-token-user:deploy-token@gitlab.example.com/org/backend.git
    branch: main
    enabled: true
```
