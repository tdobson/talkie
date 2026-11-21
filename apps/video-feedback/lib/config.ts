import { resolve } from 'node:path';

export type AdminAuthMode = 'cloudflare' | 'off';
export type TranscriberMode = 'groq' | 'fake';

export interface Config {
  dataDir: string;
  groqApiKey: string | null;
  groqBaseUrl: string;
  whisperLanguage: string;
  cfAccessTeamDomain: string | null;
  cfAccessAud: string | null;
  adminAuth: AdminAuthMode;
  transcriber: TranscriberMode;
  publicBaseUrl: string;
  isProduction: boolean;
}

type Env = Record<string, string | undefined>;

function value(env: Env, key: string): string | null {
  const v = env[key]?.trim();
  return v ? v : null;
}

function oneOf<T extends string>(env: Env, key: string, allowed: readonly T[], fallback: T): T {
  const v = value(env, key);
  if (v === null) return fallback;
  if (!allowed.includes(v as T)) {
    throw new Error(`${key}=${v} is not valid. Use one of: ${allowed.join(', ')}.`);
  }
  return v as T;
}

export function loadConfig(env: Env): Config {
  const isProduction = env.NODE_ENV === 'production';
  const adminAuth = oneOf(env, 'ADMIN_AUTH', ['cloudflare', 'off'] as const, 'cloudflare');
  const transcriber = oneOf(env, 'TRANSCRIBER', ['groq', 'fake'] as const, 'groq');
  const cfAccessTeamDomain = value(env, 'CF_ACCESS_TEAM_DOMAIN');
  const cfAccessAud = value(env, 'CF_ACCESS_AUD');

  // E2E_TEST_MODE=1 is the one escape hatch: Playwright runs the production (standalone) server.
  if (isProduction && adminAuth === 'off' && value(env, 'E2E_TEST_MODE') !== '1') {
    throw new Error(
      'ADMIN_AUTH=off is for local development only and is refused in production unless E2E_TEST_MODE=1.'
    );
  }
  if (isProduction && adminAuth === 'cloudflare' && !(cfAccessTeamDomain && cfAccessAud)) {
    throw new Error(
      'CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD must both be set when ADMIN_AUTH=cloudflare in production.'
    );
  }

  const groqApiKey = value(env, 'GROQ_API_KEY');
  const publicBaseUrl = value(env, 'PUBLIC_BASE_URL');

  if (isProduction && transcriber === 'fake' && value(env, 'E2E_TEST_MODE') !== '1') {
    throw new Error(
      'TRANSCRIBER=fake is for tests only and is refused in production unless E2E_TEST_MODE=1.'
    );
  }
  if (isProduction && transcriber === 'groq' && !groqApiKey) {
    throw new Error('GROQ_API_KEY must be set when TRANSCRIBER=groq in production.');
  }
  if (isProduction && !publicBaseUrl) {
    throw new Error(
      'PUBLIC_BASE_URL must be set in production, for example https://feedback.example.com.'
    );
  }

  return {
    // DATA_DIR is a runtime location, not part of the build: keep it out of file tracing.
    dataDir: resolve(/* turbopackIgnore: true */ value(env, 'DATA_DIR') ?? 'data'),
    groqApiKey,
    groqBaseUrl: 'https://api.groq.com/openai/v1',
    whisperLanguage: value(env, 'WHISPER_LANGUAGE') ?? 'en',
    cfAccessTeamDomain,
    cfAccessAud,
    adminAuth,
    transcriber,
    publicBaseUrl: (publicBaseUrl ?? 'http://localhost:3000').replace(/\/+$/, ''),
    isProduction,
  };
}

let cached: Config | null = null;

/** The process-wide config, read from `process.env` on first use. */
export function config(): Config {
  cached ??= loadConfig(process.env);
  return cached;
}

export function resetConfigForTests(): void {
  cached = null;
}
