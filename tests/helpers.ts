import type { AppConfig } from "../src/types.js";

type TestConfigOverrides = Partial<Omit<AppConfig, "workspace" | "auth" | "readiness" | "probe" | "git" | "limits" | "tools" | "lsp">> & {
  workspace?: Partial<AppConfig["workspace"]>;
  auth?: Partial<AppConfig["auth"]>;
  readiness?: Partial<AppConfig["readiness"]>;
  probe?: Partial<AppConfig["probe"]>;
  git?: Partial<AppConfig["git"]>;
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
    readiness: { require_all_projects_ready: false, require_at_least_one_project_ready: true },
    probe: {
      binary: "probe",
      default_search_max_results: 20,
      default_search_max_tokens: 8000,
    },
    git: {
      timeout_seconds: 30,
      default_log_limit: 30,
    },
    limits: {
      max_file_lines: 60000,
      max_file_bytes: 5000000,
      max_tool_output_bytes: 8000000,
      max_search_results: 100,
      max_git_log_limit: 200,
      command_timeout_seconds: 300,
    },
    tools: {
      enabled: [
        "list_projects",
        "project_overview",
        "search_code",
        "query_code",
        "extract_code",
        "list_symbols",
        "grep",
        "read_file",
        "list_files",
        "git_query",
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
    probe: { ...config.probe, ...overrides.probe },
    git: { ...config.git, ...overrides.git },
    limits: { ...config.limits, ...overrides.limits },
    tools: { ...config.tools, ...overrides.tools },
    lsp: { ...config.lsp, ...overrides.lsp },
  };
}
