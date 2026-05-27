import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig, GitAuthConfig, ProjectConfig } from "./types.js";

export async function prepareProjectGitAuth(config: AppConfig): Promise<void> {
  const authDir = path.join(config.workspace.state_path, "git-auth");
  process.env.SOURCESCOUT_GIT_AUTH_STATE_PATH = authDir;
  await mkdir(authDir, { recursive: true, mode: 0o700 });

  for (const project of config.projects) {
    if (!project.enabled || !project.git?.auth) {
      continue;
    }

    const projectAuthDir = path.join(authDir, project.id);
    await mkdir(projectAuthDir, { recursive: true, mode: 0o700 });

    if (project.git.auth.type === "httpsToken") {
      await prepareHttpsTokenAuth(project, project.git.auth, projectAuthDir);
      continue;
    }

    await prepareSshAuth(project, project.git.auth, projectAuthDir);
  }
}

export function gitAuthEnv(project: ProjectConfig): NodeJS.ProcessEnv {
  const auth = project.git?.auth;
  if (!auth) {
    return {};
  }

  if (auth.type === "httpsToken") {
    return {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "credential.helper",
      GIT_CONFIG_VALUE_0: `store --file ${credentialFile(project)}`,
    };
  }

  return {
    GIT_SSH_COMMAND:
      `ssh -i ${shellQuote(sshKeyFile(project))} -o IdentitiesOnly=yes ` +
      `-o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=${shellQuote(knownHostsFile(project))}`,
  };
}

async function prepareHttpsTokenAuth(
  project: ProjectConfig,
  auth: Extract<GitAuthConfig, { type: "httpsToken" }>,
  authDir: string,
): Promise<void> {
  if (!project.git?.url) {
    return;
  }

  const username = await readSecretFile(auth, auth.username_key ?? "username");
  const password = await readSecretFile(auth, auth.password_key ?? "password");
  const url = new URL(project.git.url);
  const credentials = `https://${encodeURIComponent(username.trim())}:${encodeURIComponent(password.trim())}@${url.host}\n`;

  await writeFile(credentialFile(project, authDir), credentials, { encoding: "utf8", mode: 0o600 });
}

async function prepareSshAuth(
  project: ProjectConfig,
  auth: Extract<GitAuthConfig, { type: "ssh" }>,
  authDir: string,
): Promise<void> {
  const privateKey = await readSecretFile(auth, "ssh-privatekey");
  await writeFile(sshKeyFile(project, authDir), privateKey, { encoding: "utf8", mode: 0o600 });
}

async function readSecretFile(auth: GitAuthConfig, key: string): Promise<string> {
  const secretPath = runtimeAuthPath(auth);
  try {
    return await readFile(path.join(secretPath, key), "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to read Git auth Secret key ${key} at ${secretPath}: ${message}`);
  }
}

function defaultAuthPath(auth: GitAuthConfig): string {
  return `/run/secrets/sourcescout/git-auth/${auth.type}`;
}

function runtimeAuthPath(auth: GitAuthConfig): string {
  const secretPath = auth.path ?? defaultAuthPath(auth);
  const mountedRoot = process.env.SOURCESCOUT_GIT_AUTH_ROOT ?? "/run/secrets/sourcescout/git-auth";
  const copiedRoot = process.env.SOURCESCOUT_GIT_AUTH_COPIED_ROOT ?? "/home/sourcescout/.sourcescout-git-auth";

  if (secretPath === mountedRoot || secretPath.startsWith(`${mountedRoot}/`)) {
    return path.join(copiedRoot, path.relative(mountedRoot, secretPath));
  }

  return secretPath;
}

function credentialFile(project: ProjectConfig, authDir?: string): string {
  return path.join(authDir ?? authDirFor(project), "credentials");
}

function sshKeyFile(project: ProjectConfig, authDir?: string): string {
  return path.join(authDir ?? authDirFor(project), "ssh-privatekey");
}

function knownHostsFile(project: ProjectConfig): string {
  return path.join(authDirFor(project), "known_hosts");
}

function authDirFor(project: ProjectConfig): string {
  return path.join(process.env.SOURCESCOUT_GIT_AUTH_STATE_PATH ?? "/workspace/state/git-auth", project.id);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
