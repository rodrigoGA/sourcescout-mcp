# SourceScout MCP

SourceScout MCP is a lightweight, self-hosted MCP server that helps coding agents understand multiple Git projects over HTTP.

It keeps configured repositories available on disk, refreshes managed clones on demand, and gives agents a small tool surface for answering questions about how an application actually behaves.

Use it when an agent needs to trace a flow, find the handler for a case, explain why an error is raised, understand where a value changes, inspect Git history, or follow behavior across several repositories.

SourceScout does not build an index. Instead, it lets agents navigate the real checkout with familiar tools like `rg`, `git grep`, `find`, `sed`, `git blame`, and `cloc`. In practice, this works well because modern coding agents are already good at narrowing a question into the exact files, matches, call sites, and history they need.

The result is a simple, token-efficient way to give agents source context: no indexing pipeline, no separate search backend, and no need to keep the service hot when it is not being used.

## MCP Tools

SourceScout exposes two tools:

- `list_projects`: list configured projects and their last known sync state.
- `code_inspect_shell`: inspect a configured project from its root directory so an agent can answer behavior questions with evidence from the code.

`code_inspect_shell` input is:

```json
{
  "project_id": "backend",
  "command": "rg -n \"createUser\" src"
}
```

Before running the command, SourceScout calls `ensureProjectFresh(project_id)`. If the project has a usable checkout and `workspace.pull_ttl_seconds` has expired, SourceScout starts a refresh in the background and serves the existing checkout. If the checkout is missing or unusable, it waits for sync to complete.

Useful inspection commands include `ls`, `tree`, `find`, `rg --files`, `rg "pattern"`, `grep -R`, `git grep`, `git status`, `git diff`, `git log`, `git blame`, `cat`, `sed -n 'X,Yp'`, `head`, `tail`, and `cloc`.

## Configuration

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

readiness:
  require_all_projects_ready: false
  require_at_least_one_project_ready: true

git:
  timeout_seconds: 30
  default_log_limit: 30

shell:
  readonly_user: sourcescout-readonly

limits:
  max_tool_output_bytes: 8000000
  command_timeout_seconds: 300

tools:
  enabled:
    - list_projects
    - code_inspect_shell

projects:
  - id: backend
    name: Backend API
    git:
      url: git@gitlab.example.com:org/backend.git
    branch: main
    enabled: true

  - id: local-lib
    name: Local Library
    local_path: /workspace/mounted/local-lib
    branch: main
    enabled: true
```

Use `git.url` for SourceScout-managed clones. Use `local_path` for mounted repos. SourceScout never deletes a configured `local_path`; `reclone_on_sync_failure` only applies to managed clones under `workspace.root`.

## Runtime Safety

The Docker image uses two users:

- `sourcescout`: runs the Node application and performs clone/fetch/pull.
- `sourcescout-readonly`: runs `code_inspect_shell`.

When `shell.readonly_user` is configured, SourceScout invokes:

```bash
sudo -n -u sourcescout-readonly -- /bin/sh -lc "<command>"
```

The image configures sudo only for `sourcescout` to execute `/bin/sh` as `sourcescout-readonly` without a password. Managed clones are owned by `sourcescout`; after a successful clone or pull, SourceScout applies `u+rwX,go+rX,go-w` so the read-only user can traverse and read the checkout without write access.

Mounted `local_path` repositories are not chowned or chmodded by SourceScout. They must already be readable by the configured `shell.readonly_user`.

SourceScout is intended for source inspection by authenticated agents, not as a complete sandbox for arbitrary untrusted commands. The read-only user is meant to prevent writes to managed project checkouts, but it does not by itself block network access, process creation, reads from other paths allowed by the operating system, or writes to locations such as `/tmp`. Treat MCP access as privileged, use read-only Git credentials, keep secrets out of working trees, and rely on normal container or cluster controls for stronger isolation.

The runtime still applies practical guardrails for agent use: commands run as the configured read-only user, output is bounded by `limits.max_tool_output_bytes`, and execution time is bounded by `limits.command_timeout_seconds`.

## Limits

```yaml
limits:
  max_tool_output_bytes: 8000000
  command_timeout_seconds: 300
```

`max_tool_output_bytes` caps combined stdout/stderr returned by the shell. If the cap is exceeded, SourceScout truncates the output and reports it as truncated. `command_timeout_seconds` is a global timeout for the shell command; on timeout SourceScout sends `SIGTERM` to the process group and then `SIGKILL` if needed.

## Docker

Published image:

```bash
docker pull rogo16/sourcescout-mcp:v0.0.10
```

```bash
docker run --rm -p 8080:8080 \
  -v "$PWD/config/projects.example.yml:/config/projects.yml:ro" \
  -v "$PWD/workspace:/workspace" \
  -e PROJECTS_CONFIG_PATH=/config/projects.yml \
  rogo16/sourcescout-mcp:v0.0.10
```

The image includes Node 22, Git, OpenSSH client, CA certificates, sudo, gosu, tini, and source-inspection utilities including `ls`, `cat`, `head`, `tail`, `sed`, `grep`, `find`, `rg`, `tree`, and `cloc`.

## Running Locally

```bash
pnpm install
pnpm build
PROJECTS_CONFIG_PATH=./config/projects.local.example.yml pnpm start
```

Local config does not set `shell.readonly_user`, so commands run as the same OS user as the Node process. Set `SOURCESCOUT_READONLY_USER` or `shell.readonly_user` to force sudo-based execution.

Endpoints:

- `POST /mcp`: MCP Streamable HTTP endpoint.
- `GET /live`: process liveness.
- `GET /ready`: readiness based on project sync status.
- `GET /health`: diagnostics for version, Git, shell runner, and projects.

## Claude / Agent Integration

Run SourceScout:

```bash
docker run --rm -p 8080:8080 \
  -v "$PWD/config/projects.example.yml:/config/projects.yml:ro" \
  -v "$PWD/workspace:/workspace" \
  -e PROJECTS_CONFIG_PATH=/config/projects.yml \
  -e CODE_MCP_TOKEN=change-me \
  rogo16/sourcescout-mcp:v0.0.10
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

## Kubernetes

Use:

- a `ConfigMap` for `projects.yml`
- a `Secret` for `CODE_MCP_TOKEN`
- a `Secret` for Git authentication
- a persistent volume mounted at `/workspace`

The image uses OpenSSH `StrictHostKeyChecking=accept-new` by default and stores `known_hosts` in `/workspace/state/known_hosts`, so the baseline Kubernetes manifest does not need an initContainer or a `known_hosts` Secret. For stricter host-key pinning, override `GIT_SSH_COMMAND` and mount a curated `known_hosts` file.

Keep `/live` and `/ready` unauthenticated for platform probes. Protect `/mcp` with bearer auth in non-local deployments.

See [docs/kubernetes.md](docs/kubernetes.md) for a complete baseline manifest.

## Git Authentication

SourceScout receives normal Git clone URLs. Use the same protocol you would use from a CI job or read-only automation account. For private repositories, generate credentials with the minimum read-only access needed to clone and fetch the repository.

Recommended order:

- SSH deploy key for private repos when your provider supports it.
- HTTPS token via mounted `kubernetes.io/basic-auth` Secret when SSH is not practical on Kubernetes.
- Token in the URL only for local experiments or short-lived automation, because Git can persist the remote URL inside `.git/config`.

### Public HTTPS Repository

```yaml
projects:
  - id: sourcescout
    name: SourceScout MCP
    git:
      url: https://github.com/rodrigoGA/sourcescout-mcp.git
    branch: main
    enabled: true
```

### Private Repository With SSH Deploy Key

```yaml
projects:
  - id: backend
    name: Backend API
    git:
      url: git@gitlab.example.com:org/backend.git
      auth:
        type: ssh
        path: /run/secrets/sourcescout/git-auth/gitlab
    branch: main
    enabled: true
```

### Private Repository With HTTPS Token

```yaml
projects:
  - id: github-private
    name: GitHub Private Repo
    git:
      url: https://github.com/company/private-repo.git
      auth:
        type: httpsToken
        path: /run/secrets/sourcescout/git-auth/github
    branch: main
    enabled: true
```

Mount each Secret under `/run/secrets/sourcescout/git-auth/<name>` and point the matching project auth `path` there. The entrypoint copies mounted Git auth Secrets into `/home/sourcescout/.sourcescout-git-auth` with `0600` permissions before the process drops to the `sourcescout` user.

For Docker or other non-Kubernetes deployments, a mounted `git-credentials` file is also supported:

```bash
docker run --rm -p 8080:8080 \
  -v "$PWD/config/projects.yml:/config/projects.yml:ro" \
  -v "$PWD/workspace:/workspace" \
  -v "$PWD/secrets/git-credentials:/run/secrets/sourcescout/git-credentials:ro" \
  -e CODE_MCP_TOKEN=change-me \
  rogo16/sourcescout-mcp:v0.0.10
```

Token guidance:

- GitHub: use a fine-grained personal access token scoped to selected repositories with read-only Contents access.
- GitLab: prefer a deploy token or project/group access token with `read_repository`.
- Bitbucket Cloud: use an app password or API token with repository read access.
- Gitea/Forgejo: use a token or service account with repository read access.

## MCP Registry

SourceScout can be published to the Official MCP Registry as an OCI package. The registry metadata lives in [server.json](server.json), and the Docker image includes the ownership verification label required by the registry.

See [docs/publishing.md](docs/publishing.md) for the release checklist.
