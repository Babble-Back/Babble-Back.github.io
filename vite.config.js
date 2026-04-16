import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
function readSslFile(filePath) {
    return readFileSync(resolve(process.cwd(), filePath));
}
function normalizeBasePath(basePath) {
    var trimmed = basePath.trim();
    if (!trimmed) {
        return '/';
    }
    var withLeadingSlash = trimmed.startsWith('/') ? trimmed : "/".concat(trimmed);
    return withLeadingSlash.endsWith('/')
        ? withLeadingSlash
        : "".concat(withLeadingSlash, "/");
}
function resolveBasePath(env) {
    var _a;
    var explicitBasePath = env.BASE_PATH || env.VITE_BASE_PATH;
    if (explicitBasePath) {
        return normalizeBasePath(explicitBasePath);
    }
    if (process.env.GITHUB_ACTIONS === 'true') {
        var repositoryName = (_a = process.env.GITHUB_REPOSITORY) === null || _a === void 0 ? void 0 : _a.split('/')[1];
        if (repositoryName && !repositoryName.endsWith('.github.io')) {
            return normalizeBasePath(repositoryName);
        }
    }
    return '/';
}
export default defineConfig(function (_a) {
    var mode = _a.mode;
    var env = loadEnv(mode, process.cwd(), '');
    var useHttps = env.DEV_HTTPS === 'true';
    var base = resolveBasePath(env);
    var https = useHttps && env.DEV_SSL_KEY_FILE && env.DEV_SSL_CERT_FILE
        ? {
            key: readSslFile(env.DEV_SSL_KEY_FILE),
            cert: readSslFile(env.DEV_SSL_CERT_FILE),
        }
        : undefined;
    if (useHttps && !https) {
        throw new Error('DEV_HTTPS=true requires DEV_SSL_KEY_FILE and DEV_SSL_CERT_FILE to be set.');
    }
    return {
        base: base,
        plugins: [react()],
        server: {
            host: '0.0.0.0',
            port: 5173,
            strictPort: true,
            https: https,
        },
        preview: {
            host: '0.0.0.0',
            port: 5173,
            strictPort: true,
            https: https,
        },
    };
});
