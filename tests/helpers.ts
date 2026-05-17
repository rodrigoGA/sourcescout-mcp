import type { AppConfig } from "../src/types.js";

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
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
