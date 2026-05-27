#!/bin/sh
set -eu

mkdir -p /workspace/repos /workspace/state /home/sourcescout/.ssh

if [ "$(id -u)" = "0" ]; then
  chown sourcescout:sourcescout /workspace /home/sourcescout /home/sourcescout/.ssh 2>/dev/null || true
  chown -R sourcescout:sourcescout /workspace/repos /workspace/state 2>/dev/null || true
  chmod 0755 /workspace /workspace/repos
  chmod 0700 /workspace/state /home/sourcescout/.ssh

  ssh_key_path="${SOURCESCOUT_SSH_KEY_PATH:-/run/secrets/sourcescout/id_ed25519}"
  if [ -f "$ssh_key_path" ]; then
    cp "$ssh_key_path" /home/sourcescout/.ssh/id_ed25519
    chown sourcescout:sourcescout /home/sourcescout/.ssh/id_ed25519
    chmod 0400 /home/sourcescout/.ssh/id_ed25519
  fi

  git_credentials_path="${SOURCESCOUT_GIT_CREDENTIALS_PATH:-/run/secrets/sourcescout/git-credentials}"
  if [ -f "$git_credentials_path" ]; then
    cp "$git_credentials_path" /home/sourcescout/.git-credentials
    chown sourcescout:sourcescout /home/sourcescout/.git-credentials
    chmod 0600 /home/sourcescout/.git-credentials
  fi

  git_auth_root="${SOURCESCOUT_GIT_AUTH_ROOT:-/run/secrets/sourcescout/git-auth}"
  if [ -d "$git_auth_root" ]; then
    mkdir -p /home/sourcescout/.sourcescout-git-auth
    cp -R "$git_auth_root"/. /home/sourcescout/.sourcescout-git-auth/ 2>/dev/null || true
    chown -R sourcescout:sourcescout /home/sourcescout/.sourcescout-git-auth
    find /home/sourcescout/.sourcescout-git-auth -type d -exec chmod 0700 {} +
    find /home/sourcescout/.sourcescout-git-auth -type f -exec chmod 0600 {} +
  fi

  netrc_path="${SOURCESCOUT_NETRC_PATH:-/run/secrets/sourcescout/netrc}"
  if [ -f "$netrc_path" ]; then
    cp "$netrc_path" /home/sourcescout/.netrc
    chown sourcescout:sourcescout /home/sourcescout/.netrc
    chmod 0600 /home/sourcescout/.netrc
  fi

  touch /workspace/state/known_hosts
  chown sourcescout:sourcescout /workspace/state/known_hosts
  chmod 0644 /workspace/state/known_hosts

  if [ -z "${GIT_SSH_COMMAND:-}" ]; then
    export GIT_SSH_COMMAND="ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/workspace/state/known_hosts"
  fi

  export SOURCESCOUT_GIT_AUTH_COPIED_ROOT="${SOURCESCOUT_GIT_AUTH_COPIED_ROOT:-/home/sourcescout/.sourcescout-git-auth}"

  if [ -f /home/sourcescout/.git-credentials ] && [ -z "${GIT_CONFIG_COUNT:-}" ]; then
    export GIT_CONFIG_COUNT=1
    export GIT_CONFIG_KEY_0=credential.helper
    export GIT_CONFIG_VALUE_0="store --file /home/sourcescout/.git-credentials"
  fi

  exec gosu sourcescout "$@"
fi

if [ -z "${GIT_SSH_COMMAND:-}" ]; then
  export GIT_SSH_COMMAND="ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/workspace/state/known_hosts"
fi

export SOURCESCOUT_GIT_AUTH_COPIED_ROOT="${SOURCESCOUT_GIT_AUTH_COPIED_ROOT:-/home/sourcescout/.sourcescout-git-auth}"

if [ -f /home/sourcescout/.git-credentials ] && [ -z "${GIT_CONFIG_COUNT:-}" ]; then
  export GIT_CONFIG_COUNT=1
  export GIT_CONFIG_KEY_0=credential.helper
  export GIT_CONFIG_VALUE_0="store --file /home/sourcescout/.git-credentials"
fi

exec "$@"
