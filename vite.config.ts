import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

function readSslFile(filePath: string) {
  return readFileSync(resolve(process.cwd(), filePath));
}

function normalizeBasePath(basePath: string) {
  const trimmed = basePath.trim();
  if (!trimmed) {
    return '/';
  }

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash.endsWith('/')
    ? withLeadingSlash
    : `${withLeadingSlash}/`;
}

function resolveBasePath(env: Record<string, string>) {
  const explicitBasePath = env.BASE_PATH || env.VITE_BASE_PATH;
  if (explicitBasePath) {
    return normalizeBasePath(explicitBasePath);
  }

  if (process.env.GITHUB_ACTIONS === 'true') {
    const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1];

    if (repositoryName && !repositoryName.endsWith('.github.io')) {
      return normalizeBasePath(repositoryName);
    }
  }

  return '/';
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const useHttps = env.DEV_HTTPS === 'true';
  const base = resolveBasePath(env);

  const https =
    useHttps && env.DEV_SSL_KEY_FILE && env.DEV_SSL_CERT_FILE
      ? {
          key: readSslFile(env.DEV_SSL_KEY_FILE),
          cert: readSslFile(env.DEV_SSL_CERT_FILE),
        }
      : undefined;

  if (useHttps && !https) {
    throw new Error(
      'DEV_HTTPS=true requires DEV_SSL_KEY_FILE and DEV_SSL_CERT_FILE to be set.',
    );
  }

  return {
    base,
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      https,
    },
    preview: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      https,
    },
  };
});
