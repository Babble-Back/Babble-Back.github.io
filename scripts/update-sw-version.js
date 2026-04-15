import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SERVICE_WORKER_PATH = resolve(process.cwd(), 'public/sw.js');
const BUILD_VERSION_PATTERN = /const BUILD_VERSION = '([^']*)';/;

function resolveBuildVersion() {
  const envVersion = process.env.SW_VERSION?.trim();
  if (envVersion) {
    return envVersion;
  }

  try {
    const gitHash = execSync('git rev-parse --short=12 HEAD', { encoding: 'utf8' }).trim();
    return `git-${gitHash}`;
  } catch {
    return `build-${Date.now()}`;
  }
}

const buildVersion = resolveBuildVersion();
const serviceWorkerContents = readFileSync(SERVICE_WORKER_PATH, 'utf8');
if (!BUILD_VERSION_PATTERN.test(serviceWorkerContents)) {
  throw new Error(
    `Could not find BUILD_VERSION assignment in ${SERVICE_WORKER_PATH}.`,
  );
}

const updatedContents = serviceWorkerContents.replace(
  BUILD_VERSION_PATTERN,
  `const BUILD_VERSION = '${buildVersion}';`,
);

writeFileSync(SERVICE_WORKER_PATH, updatedContents);

console.info(`Updated service worker build version to "${buildVersion}".`);
