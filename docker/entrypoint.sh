#!/bin/sh
set -eu

mkdir -p /workspace/repos /workspace/state /home/node/.ssh

if [ "$(id -u)" = "0" ]; then
  chown node:node /workspace /workspace/repos /workspace/state /home/node/.ssh 2>/dev/null || true
  chmod 0700 /home/node/.ssh

  ssh_key_path="${SOURCESCOUT_SSH_KEY_PATH:-/run/secrets/sourcescout/id_ed25519}"
  if [ -f "$ssh_key_path" ]; then
    cp "$ssh_key_path" /home/node/.ssh/id_ed25519
    chown node:node /home/node/.ssh/id_ed25519
    chmod 0400 /home/node/.ssh/id_ed25519
  fi

  git_credentials_path="${SOURCESCOUT_GIT_CREDENTIALS_PATH:-/run/secrets/sourcescout/git-credentials}"
  if [ -f "$git_credentials_path" ]; then
    cp "$git_credentials_path" /home/node/.git-credentials
    chown node:node /home/node/.git-credentials
    chmod 0600 /home/node/.git-credentials
  fi

  git_auth_root="${SOURCESCOUT_GIT_AUTH_ROOT:-/run/secrets/sourcescout/git-auth}"
  if [ -d "$git_auth_root" ]; then
    mkdir -p /home/node/.sourcescout-git-auth
    cp -R "$git_auth_root"/. /home/node/.sourcescout-git-auth/ 2>/dev/null || true
    chown -R node:node /home/node/.sourcescout-git-auth
    find /home/node/.sourcescout-git-auth -type d -exec chmod 0700 {} +
    find /home/node/.sourcescout-git-auth -type f -exec chmod 0600 {} +
  fi

  netrc_path="${SOURCESCOUT_NETRC_PATH:-/run/secrets/sourcescout/netrc}"
  if [ -f "$netrc_path" ]; then
    cp "$netrc_path" /home/node/.netrc
    chown node:node /home/node/.netrc
    chmod 0600 /home/node/.netrc
  fi

  touch /workspace/state/known_hosts
  chown node:node /workspace/state/known_hosts
  chmod 0644 /workspace/state/known_hosts

  if [ -z "${GIT_SSH_COMMAND:-}" ]; then
    export GIT_SSH_COMMAND="ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/workspace/state/known_hosts"
  fi

  if [ -f /home/node/.git-credentials ] && [ -z "${GIT_CONFIG_COUNT:-}" ]; then
    export GIT_CONFIG_COUNT=1
    export GIT_CONFIG_KEY_0=credential.helper
    export GIT_CONFIG_VALUE_0="store --file /home/node/.git-credentials"
  fi

  exec gosu node "$@"
fi

if [ -z "${GIT_SSH_COMMAND:-}" ]; then
  export GIT_SSH_COMMAND="ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/workspace/state/known_hosts"
fi

if [ -f /home/node/.git-credentials ] && [ -z "${GIT_CONFIG_COUNT:-}" ]; then
  export GIT_CONFIG_COUNT=1
  export GIT_CONFIG_KEY_0=credential.helper
  export GIT_CONFIG_VALUE_0="store --file /home/node/.git-credentials"
fi

exec "$@"
