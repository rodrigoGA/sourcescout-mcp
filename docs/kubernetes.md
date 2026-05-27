# Kubernetes Deployment

This is the baseline production shape for SourceScout MCP.

- Docker image: `rogo16/sourcescout-mcp:v0.0.10`
- a `ConfigMap` for `projects.yml`
- a bearer token `Secret` for MCP HTTP auth
- a Kubernetes Secret for Git authentication
- a PVC for managed clones and state
- unauthenticated `/live` and `/ready` probes

The image runs the application as `sourcescout` and runs `code_inspect_shell` commands through sudo as `sourcescout-readonly`. Managed clones are chmodded after clone/pull so that `sourcescout-readonly` can read and traverse them without write access.

The runtime image installs common source-inspection utilities available to the read-only shell user, including `ls`, `cat`, `head`, `tail`, `sed`, `grep`, `find`, `rg`, `tree`, `cloc`, and `git`.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: sourcescout-auth
type: Opaque
stringData:
  CODE_MCP_TOKEN: replace-me
---
apiVersion: v1
kind: Secret
metadata:
  name: sourcescout-git-auth
type: kubernetes.io/basic-auth
stringData:
  username: YOUR_GIT_USERNAME
  password: YOUR_READ_ONLY_TOKEN
---
# Alternative for SSH repo URLs:
apiVersion: v1
kind: Secret
metadata:
  name: sourcescout-git-ssh
type: kubernetes.io/ssh-auth
stringData:
  ssh-privatekey: |
    -----BEGIN OPENSSH PRIVATE KEY-----
    replace-me
    -----END OPENSSH PRIVATE KEY-----
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: sourcescout-config
data:
  projects.yml: |
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
          url: https://github.com/example/backend.git
          auth:
            type: httpsToken
            path: /run/secrets/sourcescout/git-auth/github
        branch: main
        enabled: true
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: sourcescout-workspace
spec:
  accessModes: ["ReadWriteOnce"]
  resources:
    requests:
      storage: 20Gi
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sourcescout-mcp
spec:
  replicas: 1
  selector:
    matchLabels:
      app: sourcescout-mcp
  template:
    metadata:
      labels:
        app: sourcescout-mcp
    spec:
      containers:
        - name: sourcescout-mcp
          image: rogo16/sourcescout-mcp:v0.0.10
          ports:
            - containerPort: 8080
          env:
            - name: PROJECTS_CONFIG_PATH
              value: /config/projects.yml
            - name: CODE_MCP_TOKEN
              valueFrom:
                secretKeyRef:
                  name: sourcescout-auth
                  key: CODE_MCP_TOKEN
          readinessProbe:
            httpGet:
              path: /ready
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /live
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 30
          volumeMounts:
            - name: config
              mountPath: /config
              readOnly: true
            - name: workspace
              mountPath: /workspace
            - name: github-auth
              mountPath: /run/secrets/sourcescout/git-auth/github
              readOnly: true
      volumes:
        - name: config
          configMap:
            name: sourcescout-config
        - name: workspace
          persistentVolumeClaim:
            claimName: sourcescout-workspace
        - name: github-auth
          secret:
            secretName: sourcescout-git-auth
            defaultMode: 0400
---
apiVersion: v1
kind: Service
metadata:
  name: sourcescout-mcp
spec:
  selector:
    app: sourcescout-mcp
  ports:
    - name: http
      port: 80
      targetPort: 8080
```

## Git Authentication

For HTTPS Git URLs, set `projects[].git.auth.type: httpsToken` and mount a Kubernetes `kubernetes.io/basic-auth` Secret at the matching `projects[].git.auth.path`. The Secret must contain `username` and `password` keys. The entrypoint copies mounted Git auth Secrets into `/home/sourcescout/.sourcescout-git-auth` with `0600` permissions, and SourceScout configures Git per project before cloning.

For SSH Git URLs, use `projects[].git.auth.type: ssh` and mount a Kubernetes `kubernetes.io/ssh-auth` Secret at the matching path. The Secret must contain the `ssh-privatekey` key.

The image handles SSH host keys by default with OpenSSH `StrictHostKeyChecking=accept-new` and stores `known_hosts` in `/workspace/state/known_hosts`. For stricter SSH host-key pinning, override `GIT_SSH_COMMAND` and mount a curated `known_hosts` file.

## Mounted Local Paths

If a project uses `local_path`, Kubernetes must mount it so that `sourcescout-readonly` can read and traverse the tree. SourceScout does not chown or chmod mounted external repositories.
