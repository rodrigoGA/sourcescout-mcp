export const TOOL_NAMES = [
  "list_projects",
  "code_inspect_shell",
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
  git?: ProjectGitConfig;
  branch: string;
  local_path?: string;
  enabled: boolean;
}

export interface ProjectGitConfig {
  url: string;
  auth?: GitAuthConfig;
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

export interface GitConfig {
  timeout_seconds: number;
  default_log_limit: number;
}

export interface ShellConfig {
  readonly_user?: string;
}

export type GitAuthConfig =
  | {
      type: "ssh";
      path?: string;
    }
  | {
      type: "httpsToken";
      path?: string;
      username_key?: string;
      password_key?: string;
    };

export interface LimitsConfig {
  max_tool_output_bytes: number;
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
  git: GitConfig;
  shell: ShellConfig;
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

export interface ShellCommandResult {
  command: string;
  args: string[];
  cwd: string;
  exitCode: number | null;
  output: string;
  sanitized: boolean;
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
