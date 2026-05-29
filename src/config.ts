import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { z } from "zod";
import { TOOL_NAMES, type AppConfig, type ReadinessMode } from "./types.js";

const toolNameSchema = z.enum(TOOL_NAMES);
const readinessModeSchema = z.enum(["immediate", "one_project", "all_projects"]);
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
  mode: "one_project" as const,
};
const defaultGit = {
  timeout_seconds: 30,
  default_log_limit: 30,
};
const defaultShell = {};
const defaultLimits = {
  max_tool_output_bytes: 8000000,
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
      mode: readinessModeSchema.optional(),
      require_all_projects_ready: z.boolean().optional(),
      require_at_least_one_project_ready: z.boolean().optional(),
    })
    .default(defaultReadiness)
    .transform((readiness) => ({
      mode: readiness.mode ?? legacyReadinessMode(readiness),
    })),
  git: z
    .object({
      timeout_seconds: z.number().int().positive().default(30),
      default_log_limit: z.number().int().positive().default(30),
    })
    .default(defaultGit),
  shell: z
    .object({
      readonly_user: z.string().min(1).optional(),
    })
    .default(defaultShell),
  limits: z
    .object({
      max_tool_output_bytes: z.number().int().positive().default(8000000),
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
  if (process.env.SOURCESCOUT_READONLY_USER) {
    config.shell.readonly_user = process.env.SOURCESCOUT_READONLY_USER;
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

function legacyReadinessMode(readiness: {
  require_all_projects_ready?: boolean;
  require_at_least_one_project_ready?: boolean;
}): ReadinessMode {
  if (readiness.require_all_projects_ready) {
    return "all_projects";
  }
  if (readiness.require_at_least_one_project_ready === false) {
    return "immediate";
  }
  return "one_project";
}
