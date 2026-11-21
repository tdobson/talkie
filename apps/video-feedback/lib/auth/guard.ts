import type { JWTVerifyGetKey } from 'jose';
import { config } from '@/lib/config';
import { type AccessIdentity, verifyAccessJwt } from './access';

const ACCESS_HEADER = 'cf-access-jwt-assertion';

/** `jwks` replaces the remote Cloudflare key set. It exists for tests. */
export interface GuardOptions {
  jwks?: JWTVerifyGetKey;
}

type AdminCheck = { ok: true; identity: AccessIdentity | null } | { ok: false; response: Response };

function unauthorised(): Response {
  return Response.json(
    { error: 'unauthorised' },
    { status: 401, headers: { 'Cache-Control': 'no-store' } }
  );
}

/** Returns the identity, null when admin auth is off, or throws when access is refused. */
async function identify(headers: Headers, opts: GuardOptions): Promise<AccessIdentity | null> {
  const cfg = config();
  if (cfg.adminAuth === 'off') return null;

  const jwt = headers.get(ACCESS_HEADER);
  if (!jwt) throw new Error('No Access token.');
  // Fail closed: without both settings there is nothing to verify against.
  if (!cfg.cfAccessTeamDomain || !cfg.cfAccessAud) throw new Error('Access is not configured.');
  return verifyAccessJwt(jwt, {
    teamDomain: cfg.cfAccessTeamDomain,
    aud: cfg.cfAccessAud,
    jwks: opts.jwks,
  });
}

/**
 * Checks the Cloudflare Access token on a request. Any failure gives the same bare 401,
 * so the response says nothing about why.
 */
export async function checkAdmin(req: Request, opts: GuardOptions = {}): Promise<AdminCheck> {
  try {
    return { ok: true, identity: await identify(req.headers, opts) };
  } catch {
    return { ok: false, response: unauthorised() };
  }
}

const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

function refused(status: 403 | 415, error: string): Response {
  return Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Cross-site request forgery check for requests that change something. Cloudflare Access adds
 * its token to any request that carries the admin's cookie, a form posted from another site
 * included, so the token alone does not prove the admin meant to send it.
 *
 * - A browser says where a request came from (`Origin`, `Sec-Fetch-Site`): anything but this
 *   site is refused.
 * - A body must be JSON. The types a plain HTML form can send are refused, and JSON from
 *   another site needs a CORS preflight, which this app never answers.
 * - Clients that are not browsers (curl with a service token) send neither header and pass.
 *
 * Returns the refusal, or null when the request may go ahead.
 */
export function checkSameOrigin(req: Request): Response | null {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return null;

  const site = req.headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin' && site !== 'none') {
    return refused(403, 'cross-site request refused');
  }
  const origin = req.headers.get('origin');
  if (origin !== null) {
    const allowed = [originOf(config().publicBaseUrl), originOf(req.url)];
    if (!allowed.includes(origin)) return refused(403, 'cross-site request refused');
  }
  const type = req.headers.get('content-type');
  if (type !== null && !/^application\/json\b/i.test(type.trim())) {
    return refused(415, 'the request body must be JSON');
  }
  return null;
}

/** Wraps a route handler so it only runs for an admin, and never for a forged request. */
export function withAdmin<C>(
  handler: (req: Request, ctx: C) => Promise<Response>,
  opts: GuardOptions = {}
): (req: Request, ctx: C) => Promise<Response> {
  return async (req, ctx) => {
    const check = await checkAdmin(req, opts);
    if (!check.ok) return check.response;
    return checkSameOrigin(req) ?? handler(req, ctx);
  };
}

/**
 * For server components under /admin. Returns the identity (null when admin auth is off)
 * and renders the 404 page when access is refused, so the admin area is not advertised.
 */
export async function requireAdminPage(): Promise<AccessIdentity | null> {
  const { headers } = await import('next/headers');
  const { notFound } = await import('next/navigation');
  const requestHeaders = await headers();
  try {
    return await identify(requestHeaders, {});
  } catch {
    return notFound();
  }
}
