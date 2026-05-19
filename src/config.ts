import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { z } from "zod";
import { TOOL_NAMES, type AppConfig } from "./types.js";

const toolNameSchema = z.enum(TOOL_NAMES);
const defaultServer = { name: "SourceScout MCP", port: 8080 };
const defaultWorkspace = {
  root: "/workspace/repos",
  state_path: "/workspace/state",
  clone_on_startup: true,
  pull_on_startup: true,
  pull_ttl_seconds: 300,
  sync_timeout_seconds: 600,
  reclone_on_sync_failure: true,
};
const defaultAuth = { enabled: false, type: "bearer" as const, token_env: "CODE_MCP_TOKEN" };
const defaultReadiness = {
  require_all_projects_ready: false,
  require_at_least_one_project_ready: true,
};
const defaultProbe = {
  binary: "probe",
  default_search_max_results: 20,
  default_search_max_tokens: 8000,
};
const defaultGit = {
  timeout_seconds: 30,
  default_log_limit: 30,
};
const defaultLimits = {
  max_file_lines: 60000,
  max_file_bytes: 5000000,
  max_tool_output_bytes: 8000000,
  max_search_results: 100,
  max_git_log_limit: 200,
  command_timeout_seconds: 300,
};
const defaultTools = { enabled: [...TOOL_NAMES] };
const defaultLsp = { enabled: false };

const gitAuthSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ssh"),
    path: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("httpsToken"),
    path: z.string().min(1).optional(),
    username_key: z.string().min(1).optional(),
    password_key: z.string().min(1).optional(),
  }),
]);

const configSchema = z.object({
  server: z
    .object({
      name: z.string().min(1).default("SourceScout MCP"),
      port: z.coerce.number().int().positive().default(8080),
    })
    .default(defaultServer),
  workspace: z
    .object({
      root: z.string().min(1).default("/workspace/repos"),
      state_path: z.string().min(1).default("/workspace/state"),
      clone_on_startup: z.boolean().default(true),
      pull_on_startup: z.boolean().default(true),
      pull_ttl_seconds: z.number().int().nonnegative().default(300),
      sync_timeout_seconds: z.number().int().positive().default(600),
      reclone_on_sync_failure: z.boolean().default(true),
    })
    .default(defaultWorkspace),
  auth: z
    .object({
      enabled: z.boolean().default(false),
      type: z.literal("bearer").default("bearer"),
      token_env: z.string().min(1).default("CODE_MCP_TOKEN"),
    })
    .default(defaultAuth),
  readiness: z
    .object({
      require_all_projects_ready: z.boolean().default(false),
      require_at_least_one_project_ready: z.boolean().default(true),
    })
    .default(defaultReadiness),
  probe: z
    .object({
      binary: z.string().min(1).default("probe"),
      default_search_max_results: z.number().int().positive().default(20),
      default_search_max_tokens: z.number().int().positive().default(8000),
    })
    .default(defaultProbe),
  git: z
    .object({
      timeout_seconds: z.number().int().positive().default(30),
      default_log_limit: z.number().int().positive().default(30),
    })
    .default(defaultGit),
  limits: z
    .object({
      max_file_lines: z.number().int().positive().default(60000),
      max_file_bytes: z.number().int().positive().default(5000000),
      max_tool_output_bytes: z.number().int().positive().default(8000000),
      max_search_results: z.number().int().positive().default(100),
      max_git_log_limit: z.number().int().positive().default(200),
      command_timeout_seconds: z.number().int().positive().default(300),
    })
    .default(defaultLimits),
  tools: z
    .object({
      enabled: z.array(toolNameSchema).default([...TOOL_NAMES]),
    })
    .default(defaultTools),
  lsp: z
    .object({
      enabled: z.boolean().default(false),
    })
    .default(defaultLsp),
  projects: z
    .array(
      z
        .object({
          id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/),
          name: z.string().min(1),
          description: z.string().optional(),
          git: z
            .object({
              url: z.string().min(1),
              auth: gitAuthSchema.optional(),
            })
            .optional(),
          branch: z.string().min(1).default("main"),
          local_path: z.string().min(1).optional(),
          enabled: z.boolean().default(true),
        })
        .refine((project) => Boolean(project.git?.url || project.local_path), {
          message: "project requires either git.url or local_path",
        }),
    )
    .default([]),
});

export async function loadConfig(path = process.env.PROJECTS_CONFIG_PATH ?? "/config/projects.yml"): Promise<AppConfig> {
  const raw = await readFile(path, "utf8");
  const parsed = parse(raw) as unknown;
  const config = configSchema.parse(parsed) as AppConfig;

  if (process.env.PORT) {
    config.server.port = Number(process.env.PORT);
  }
  if (process.env.WORKSPACE_ROOT) {
    config.workspace.root = process.env.WORKSPACE_ROOT;
  }
  if (process.env.WORKSPACE_STATE_PATH) {
    config.workspace.state_path = process.env.WORKSPACE_STATE_PATH;
  }
  if (process.env.PROBE_BINARY) {
    config.probe.binary = process.env.PROBE_BINARY;
  }

  const uniqueProjectIds = new Set<string>();
  for (const project of config.projects) {
    if (uniqueProjectIds.has(project.id)) {
      throw new Error(`duplicate project id: ${project.id}`);
    }
    uniqueProjectIds.add(project.id);
  }

  return config;
}
