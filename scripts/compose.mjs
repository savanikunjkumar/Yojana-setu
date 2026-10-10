#!/usr/bin/env node
/**
 * Runs `docker compose …` against whichever container engine this machine actually has.
 *
 * The Docker CLI talks to a daemon socket, and on a machine running rootless podman
 * instead there is no daemon at `/var/run/docker.sock` — so every compose command
 * fails with "check if the path is correct and if the daemon is running" until
 * `DOCKER_HOST` is exported. Expecting each teammate to remember that env var is a
 * reliable way to lose twenty minutes, so the socket is resolved here instead.
 *
 * Podman's socket is API-compatible with Docker's, which is why pointing the Docker
 * CLI at it works unchanged. Anyone with a real Docker daemon is unaffected: their
 * socket is found first and `DOCKER_HOST` is left alone.
 *
 * Usage:  node scripts/compose.mjs up -d postgres
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const DOCKER_SOCKET = '/var/run/docker.sock';

function resolveDockerHost() {
  // An explicit setting always wins — the caller knows something we do not.
  if (process.env.DOCKER_HOST) {
    return { host: process.env.DOCKER_HOST, source: 'DOCKER_HOST from the environment' };
  }

  if (existsSync(DOCKER_SOCKET)) {
    return { host: undefined, source: 'the Docker daemon socket' };
  }

  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (uid !== null) {
    const podmanSocket = `/run/user/${uid}/podman/podman.sock`;
    if (existsSync(podmanSocket)) {
      return { host: `unix://${podmanSocket}`, source: 'the rootless podman socket' };
    }
  }

  return { host: undefined, source: null };
}

const { host, source } = resolveDockerHost();

if (source === null) {
  console.error(
    [
      'No container engine socket found.',
      '',
      'Start one of these, then try again:',
      '  Docker   sudo systemctl start docker',
      '  podman   systemctl --user enable --now podman.socket',
      '',
      'podman is a drop-in here: its socket is Docker-API compatible, and this wrapper',
      'points the Docker CLI at it automatically once the socket exists.',
      '',
      'To run Postgres without any container engine, see "Running without containers"',
      'in the README.',
    ].join('\n'),
  );
  process.exit(1);
}

if (host && !process.env.DOCKER_HOST) {
  console.error(`[compose] using ${source}`);
}

const child = spawn('docker', ['compose', ...process.argv.slice(2)], {
  // Inherited stdio keeps `exec -it` interactive and lets `db:verify` pipe a file in.
  stdio: 'inherit',
  env: host ? { ...process.env, DOCKER_HOST: host } : process.env,
});

child.on('error', (error) => {
  if (error.code === 'ENOENT') {
    console.error(
      'The `docker` CLI is not installed. Install Docker CLI (it works against podman),\n' +
        'or run compose commands with `podman compose` directly.',
    );
    process.exit(1);
  }
  console.error(error.message);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
