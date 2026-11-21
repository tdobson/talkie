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

  if (isProduction && adminAuth === 'off') {
    throw new Error('ADMIN_AUTH=off is for local development only and is refused in production.');
  }
  if (isProduction && adminAuth === 'cloudflare' && !(cfAccessTeamDomain && cfAccessAud)) {
    throw new Error(
      'CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD must both be set when ADMIN_AUTH=cloudflare in production.'
    );
  }

  return {
    dataDir: resolve(value(env, 'DATA_DIR') ?? 'data'),
    groqApiKey: value(env, 'GROQ_API_KEY'),
    groqBaseUrl: 'https://api.groq.com/openai/v1',
    whisperLanguage: value(env, 'WHISPER_LANGUAGE') ?? 'en',
    cfAccessTeamDomain,
    cfAccessAud,
    adminAuth,
    transcriber,
    publicBaseUrl: (value(env, 'PUBLIC_BASE_URL') ?? 'http://localhost:3000').replace(/\/+$/, ''),
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
