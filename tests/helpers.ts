import type { AppConfig } from "../src/types.js";

type TestConfigOverrides = Partial<Omit<AppConfig, "workspace" | "auth" | "readiness" | "git" | "shell" | "limits" | "tools" | "lsp">> & {
  workspace?: Partial<AppConfig["workspace"]>;
  auth?: Partial<AppConfig["auth"]>;
  readiness?: Partial<AppConfig["readiness"]>;
  git?: Partial<AppConfig["git"]>;
  shell?: Partial<AppConfig["shell"]>;
  limits?: Partial<AppConfig["limits"]>;
  tools?: Partial<AppConfig["tools"]>;
  lsp?: Partial<AppConfig["lsp"]>;
};

export function testConfig(overrides: TestConfigOverrides = {}): AppConfig {
  const config: AppConfig = {
    server: { name: "SourceScout MCP", port: 8080 },
    workspace: {
      root: "/tmp/sourcescout-test/repos",
      state_path: "/tmp/sourcescout-test/state",
      clone_on_startup: false,
      pull_on_startup: false,
      pull_ttl_seconds: 300,
      sync_timeout_seconds: 60,
      reclone_on_sync_failure: true,
    },
    auth: { enabled: false, type: "bearer", token_env: "CODE_MCP_TOKEN" },
    readiness: { mode: "one_project" },
    git: {
      timeout_seconds: 30,
      default_log_limit: 30,
    },
    shell: {},
    limits: {
      max_tool_output_bytes: 8000000,
      command_timeout_seconds: 300,
    },
    tools: {
      enabled: [
        "list_projects",
        "code_inspect_shell",
      ],
    },
    lsp: { enabled: false },
    projects: [],
  };
  return {
    ...config,
    ...overrides,
    workspace: { ...config.workspace, ...overrides.workspace },
    auth: { ...config.auth, ...overrides.auth },
    readiness: { ...config.readiness, ...overrides.readiness },
    git: { ...config.git, ...overrides.git },
    shell: { ...config.shell, ...overrides.shell },
    limits: { ...config.limits, ...overrides.limits },
    tools: { ...config.tools, ...overrides.tools },
    lsp: { ...config.lsp, ...overrides.lsp },
  };
}
