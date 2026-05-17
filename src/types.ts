export const TOOL_NAMES = [
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
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export type ProjectStatus =
  | "ready"
  | "syncing"
  | "stale"
  | "error"
  | "missing"
  | "disabled";

export interface ProjectConfig {
  id: string;
  name: string;
  description?: string;
  repo_url?: string;
  branch: string;
  local_path?: string;
  enabled: boolean;
}

export interface ServerConfig {
  name: string;
  port: number;
}

export interface WorkspaceConfig {
  root: string;
  state_path: string;
  clone_on_startup: boolean;
  pull_on_startup: boolean;
  pull_ttl_seconds: number;
  sync_timeout_seconds: number;
  reclone_on_sync_failure: boolean;
}

export interface AuthConfig {
  enabled: boolean;
  type: "bearer";
  token_env: string;
}

export interface ReadinessConfig {
  require_all_projects_ready: boolean;
  require_at_least_one_project_ready: boolean;
}

export interface ProbeConfig {
  binary: string;
}

export interface GitConfig {
  timeout_seconds: number;
  default_log_limit: number;
}

export interface LimitsConfig {
  max_file_lines: number;
  max_file_bytes: number;
  max_tool_output_bytes: number;
  max_search_results: number;
  max_git_log_limit: number;
  command_timeout_seconds: number;
}

export interface ToolsConfig {
  enabled: ToolName[];
}

export interface LspConfig {
  enabled: boolean;
}

export interface AppConfig {
  server: ServerConfig;
  workspace: WorkspaceConfig;
  auth: AuthConfig;
  readiness: ReadinessConfig;
  probe: ProbeConfig;
  git: GitConfig;
  limits: LimitsConfig;
  tools: ToolsConfig;
  lsp: LspConfig;
  projects: ProjectConfig[];
}

export interface ProjectRuntimeState {
  status: ProjectStatus;
  last_sync_at: string | null;
  last_error: string | null;
  local_path: string;
  current_head: string | null;
}

export type ProjectStateMap = Record<string, ProjectRuntimeState>;

export interface RegisteredProject {
  config: ProjectConfig;
  localPath: string;
  managedClone: boolean;
  state: ProjectRuntimeState;
}

export interface CommandResult {
  command: string;
  args: string[];
  cwd?: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
}

export class SourceScoutError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "SourceScoutError";
  }
}
