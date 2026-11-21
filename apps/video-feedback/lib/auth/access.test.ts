import { createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload, SignJWT } from 'jose';
import { verifyAccessJwt } from './access';

const teamDomain = 'team.cloudflareaccess.com';
const aud = 'aud-tag-123';

type Keys = Awaited<ReturnType<typeof generateKeyPair>>;
let keys: Keys;
let jwks: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  keys = await generateKeyPair('RS256');
  jwks = createLocalJWKSet({
    keys: [{ ...(await exportJWK(keys.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }],
  });
});

async function sign(
  claims: JWTPayload,
  over: { aud?: string; iss?: string; exp?: number; key?: Keys['privateKey']; sub?: string } = {}
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(over.iss ?? `https://${teamDomain}`)
    .setAudience(over.aud ?? aud)
    .setSubject(over.sub ?? 'user-123')
    .setIssuedAt()
    .setExpirationTime(over.exp ?? Math.floor(Date.now() / 1000) + 300)
    .sign(over.key ?? keys.privateKey);
}

it('accepts a valid user token', async () => {
  const id = await verifyAccessJwt(await sign({ email: 'tim@example.com' }), {
    teamDomain,
    aud,
    jwks,
  });
  expect(id).toEqual({ email: 'tim@example.com', serviceToken: false, sub: expect.any(String) });
});

it('accepts a service token (no email, has common_name)', async () => {
  const id = await verifyAccessJwt(await sign({ common_name: 'abc.access' }, { sub: '' }), {
    teamDomain,
    aud,
    jwks,
  });
  expect(id.serviceToken).toBe(true);
  expect(id.email).toBeNull();
  expect(id.sub).toBe('abc.access');
});

it.each([
  ['wrong audience', { aud: 'other' }],
  ['expired', { exp: Math.floor(Date.now() / 1000) - 60 }],
  ['wrong issuer', { iss: 'https://evil.cloudflareaccess.com' }],
])('rejects %s', async (_n, over) => {
  await expect(
    verifyAccessJwt(await sign({ email: 'x@y.z' }, over), { teamDomain, aud, jwks })
  ).rejects.toThrow();
});

it('rejects a token signed by another key', async () => {
  const other = await generateKeyPair('RS256');
  await expect(
    verifyAccessJwt(await sign({ email: 'x@y.z' }, { key: other.privateKey }), {
      teamDomain,
      aud,
      jwks,
    })
  ).rejects.toThrow();
});

it('rejects an unsigned (alg none) token and an HS256 token', async () => {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const payload = {
    email: 'x@y.z',
    iss: `https://${teamDomain}`,
    aud,
    sub: 's',
    exp: Math.floor(Date.now() / 1000) + 300,
  };
  const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.`;
  await expect(verifyAccessJwt(none, { teamDomain, aud, jwks })).rejects.toThrow();
  const hs = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256', kid: 'k1' })
    .sign(new TextEncoder().encode('a-shared-secret-that-is-long-enough-123'));
  await expect(verifyAccessJwt(hs, { teamDomain, aud, jwks })).rejects.toThrow();
});

it('rejects a token with neither email nor common_name, and garbage', async () => {
  await expect(verifyAccessJwt(await sign({}), { teamDomain, aud, jwks })).rejects.toThrow();
  await expect(verifyAccessJwt('garbage', { teamDomain, aud, jwks })).rejects.toThrow();
  await expect(verifyAccessJwt('', { teamDomain, aud, jwks })).rejects.toThrow();
});

it('rejects a token with no expiry', async () => {
  const jwt = await new SignJWT({ email: 'x@y.z' })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(`https://${teamDomain}`)
    .setAudience(aud)
    .setSubject('s')
    .sign(keys.privateKey);
  await expect(verifyAccessJwt(jwt, { teamDomain, aud, jwks })).rejects.toThrow();
});

it('refuses an empty team domain or audience', async () => {
  const jwt = await sign({ email: 'x@y.z' });
  await expect(verifyAccessJwt(jwt, { teamDomain: '', aud, jwks })).rejects.toThrow();
  await expect(verifyAccessJwt(jwt, { teamDomain, aud: '', jwks })).rejects.toThrow();
});

it('accepts a team domain written with a scheme or trailing slash', async () => {
  const id = await verifyAccessJwt(await sign({ email: 'tim@example.com' }), {
    teamDomain: `https://${teamDomain}/`,
    aud,
    jwks,
  });
  expect(id.email).toBe('tim@example.com');
});
