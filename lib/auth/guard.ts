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

/** Wraps a route handler so it only runs for an admin. */
export function withAdmin<C>(
  handler: (req: Request, ctx: C) => Promise<Response>,
  opts: GuardOptions = {}
): (req: Request, ctx: C) => Promise<Response> {
  return async (req, ctx) => {
    const check = await checkAdmin(req, opts);
    if (!check.ok) return check.response;
    return handler(req, ctx);
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
