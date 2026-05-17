# Kubernetes Deployment

This is the baseline production shape for SourceScout MCP. It keeps the manifest small:

- a `ConfigMap` for `projects.yml`
- a bearer token `Secret`
- an optional SSH deploy key `Secret`
- an optional `.netrc` Secret for HTTPS Git tokens
- a PVC for local clones and state
- unauthenticated `/live` and `/ready` probes

The image handles SSH host keys by default with OpenSSH `StrictHostKeyChecking=accept-new` and stores `known_hosts` in `/workspace/state/known_hosts`. This avoids asking every deployment to maintain a `known_hosts` Secret. For stricter environments, override `GIT_SSH_COMMAND` and mount a pinned `known_hosts` file.

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
  name: sourcescout-ssh
type: Opaque
stringData:
  id_ed25519: |
    -----BEGIN OPENSSH PRIVATE KEY-----
    replace-me
    -----END OPENSSH PRIVATE KEY-----
  # Optional for HTTPS token auth instead of SSH:
  # netrc: |
  #   machine github.com
  #     login YOUR_USERNAME
  #     password YOUR_READ_ONLY_TOKEN
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
    projects:
      - id: backend
        name: Backend API
        repo_url: git@github.com:example/backend.git
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
          image: sourcescout-mcp:0.1.0
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
            - name: SOURCESCOUT_SSH_KEY_PATH
              value: /run/secrets/sourcescout/id_ed25519
            - name: SOURCESCOUT_NETRC_PATH
              value: /run/secrets/sourcescout/netrc
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
            - name: ssh-key
              mountPath: /run/secrets/sourcescout
              readOnly: true
      volumes:
        - name: config
          configMap:
            name: sourcescout-config
        - name: workspace
          persistentVolumeClaim:
            claimName: sourcescout-workspace
        - name: ssh-key
          secret:
            secretName: sourcescout-ssh
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

## Strict Host-Key Pinning

The default is trust-on-first-use, stored persistently in `/workspace/state/known_hosts`. That is practical for internal tools and avoids requiring a host-key secret.

If your security policy requires pinned host keys, mount a curated `known_hosts` file and override:

```yaml
env:
  - name: GIT_SSH_COMMAND
    value: ssh -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/etc/sourcescout/known_hosts
```

For HTTPS Git URLs, skip `id_ed25519` and provide a `netrc` key in the same `sourcescout-ssh` Secret, or use your platform's preferred credential strategy such as a Git credential helper or a token-injected repo URL.
