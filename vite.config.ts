import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const BUILD_NUMBER_OFFSET = 8;

function resolveProgressiveBuildInfo(): {
  version: string;
  buildNumber: number;
  commitSha: string;
} {
  let baseMajorMinor = '1.0';
  try {
    const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
      version?: string;
    };
    const parts = (pkg.version ?? '1.0.0').split('.');
    if (parts.length >= 2) {
      baseMajorMinor = `${parts[0]}.${parts[1]}`;
    }
  } catch {
    // Keep default 1.0 base
  }

  let buildNumber = BUILD_NUMBER_OFFSET + 1;
  let commitSha = 'local';
  try {
    const rawCount = execFileSync('git', ['rev-list', '--count', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const parsedCount = Number.parseInt(rawCount, 10);
    if (Number.isFinite(parsedCount) && parsedCount > 0) {
      buildNumber = BUILD_NUMBER_OFFSET + parsedCount;
    }
  } catch {
    // Fallback outside git worktree
  }

  try {
    const rawSha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (/^[0-9a-f]{4,12}$/i.test(rawSha)) {
      commitSha = rawSha;
    }
  } catch {
    // Fallback outside git worktree
  }

  return {
    version: `${baseMajorMinor}.${buildNumber}`,
    buildNumber,
    commitSha,
  };
}

const buildInfo = resolveProgressiveBuildInfo();

function normalizeBasePath(raw?: string): string {
  const trimmed = raw?.trim();
  if (!trimmed || trimmed === '/') {
    return '/';
  }
  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

const basePath = normalizeBasePath(process.env.VITE_BASE_PATH);

const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

export default defineConfig({
  base: basePath,
  define: {
    __APP_VERSION__: JSON.stringify(buildInfo.version),
    __APP_BUILD_NUMBER__: JSON.stringify(buildInfo.buildNumber),
    __APP_COMMIT_SHA__: JSON.stringify(buildInfo.commitSha),
  },
  server: {
    host: true,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  },
  preview: {
    host: true,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Clear-Site-Data': '"cache"',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    },
  },
  plugins: [
    {
      name: 'dojo-timer-production-csp',
      apply: 'build',
      transformIndexHtml(html) {
        const metaCsp = `    <meta http-equiv="Content-Security-Policy" content="${PRODUCTION_CSP}" />`;
        return html.replace(
          '    <meta name="referrer" content="no-referrer" />',
          `    <meta name="referrer" content="no-referrer" />\n${metaCsp}`,
        );
      },
    },
    react(),
    tailwindcss(),
    VitePWA({
      base: basePath,
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: [
        'pwa-icon.svg',
        'apple-touch-icon.png',
        'pwa-192x192.png',
        'pwa-512x512.png',
        'audio/gong.mp3',
        'audio/campanella-preavviso.mp3',
        'audio/campanella-fine.mp3',
        'audio/kenguro/hajime.mp3',
        'audio/kenguro/matte.mp3',
        'audio/kenguro/soremade.mp3',
        'audio/kenguro/count-1.mp3',
        'audio/kenguro/count-2.mp3',
        'audio/kenguro/count-3.mp3',
        'audio/kenguro/count-4.mp3',
        'audio/kenguro/count-5.mp3',
        'audio/kenguro/count-6.mp3',
        'audio/kenguro/count-7.mp3',
        'audio/kenguro/count-8.mp3',
        'audio/kenguro/count-9.mp3',
        'audio/kenguro/count-10.mp3',
        'audio/arale/hajime.mp3',
        'audio/arale/matte.mp3',
        'audio/arale/soremade.mp3',
        'audio/arale/count-1.mp3',
        'audio/arale/count-2.mp3',
        'audio/arale/count-3.mp3',
        'audio/arale/count-4.mp3',
        'audio/arale/count-5.mp3',
        'audio/arale/count-6.mp3',
        'audio/arale/count-7.mp3',
        'audio/arale/count-8.mp3',
        'audio/arale/count-9.mp3',
        'audio/arale/count-10.mp3',
        'logos/judo-logo.jpg',
        'logos/bjj-logo.png',
      ],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,jpg,jpeg,ico,woff,woff2,mp3}'],
        navigateFallbackDenylist: [/\.apk$/i],
      },
      manifest: {
        name: 'Dojo Timer — Judo & BJJ Interval Timer',
        short_name: 'Dojo Timer',
        description: 'Timer da tatami ad altissimo contrasto per Judo, BJJ, MMA e sparring.',
        lang: 'it',
        start_url: basePath,
        scope: basePath,
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        orientation: 'any',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: 'pwa-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
    }),
  ],
});
