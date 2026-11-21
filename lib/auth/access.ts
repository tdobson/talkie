import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from 'jose';

export interface AccessIdentity {
  /** The signed-in user's email, or null for a service token. */
  email: string | null;
  serviceToken: boolean;
  sub: string;
}

const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** Accepts `team.cloudflareaccess.com`, with or without a scheme or trailing slash. */
function normaliseTeamDomain(teamDomain: string): string {
  const host = teamDomain
    .trim()
    .toLowerCase()
    .replace(/^https:\/\//, '')
    .replace(/\/+$/, '');
  if (!HOSTNAME_RE.test(host)) throw new Error('Invalid Cloudflare Access team domain.');
  return host;
}

// One remote key set per team domain. jose caches the keys and refetches on an unknown `kid`
// (rate limited by its cooldown), which covers Cloudflare's key rotation.
const remoteKeySets = new Map<string, JWTVerifyGetKey>();

function remoteJwks(host: string): JWTVerifyGetKey {
  let keys = remoteKeySets.get(host);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`https://${host}/cdn-cgi/access/certs`));
    remoteKeySets.set(host, keys);
  }
  return keys;
}

/**
 * Verifies a Cloudflare Access application token (the `Cf-Access-Jwt-Assertion` header).
 * Pins the algorithm to RS256, the issuer to the team domain and the audience to the
 * application's AUD tag, and requires an expiry. Throws on any failure.
 */
export async function verifyAccessJwt(
  jwt: string,
  opts: { teamDomain: string; aud: string; jwks?: JWTVerifyGetKey }
): Promise<AccessIdentity> {
  if (!opts.aud) throw new Error('Cloudflare Access audience is not set.');
  const host = normaliseTeamDomain(opts.teamDomain);

  const { payload } = await jwtVerify(jwt, opts.jwks ?? remoteJwks(host), {
    algorithms: ['RS256'],
    issuer: `https://${host}`,
    audience: opts.aud,
    requiredClaims: ['exp'],
  });

  const email = typeof payload.email === 'string' && payload.email ? payload.email : null;
  const commonName =
    typeof payload.common_name === 'string' && payload.common_name ? payload.common_name : null;

  // A user token carries `email`. A service token has no email but carries `common_name`
  // (its client id) and an empty `sub`.
  if (email !== null) {
    return { email, serviceToken: false, sub: payload.sub || email };
  }
  if (commonName !== null) {
    return { email: null, serviceToken: true, sub: payload.sub || commonName };
  }
  throw new Error('Access token has neither email nor common_name.');
}
