import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { resetConfigForTests } from '@/lib/config';
import { checkAdmin, withAdmin } from './guard';

const mocks = vi.hoisted(() => ({
  headers: vi.fn(async () => new Headers()),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('next/headers', () => ({ headers: mocks.headers }));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));

const teamDomain = 'team.cloudflareaccess.com';
const aud = 'aud-tag-123';
const KEYS = ['ADMIN_AUTH', 'CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetConfigForTests();
});

function cloudflare() {
  process.env.ADMIN_AUTH = 'cloudflare';
  process.env.CF_ACCESS_TEAM_DOMAIN = teamDomain;
  process.env.CF_ACCESS_AUD = aud;
  resetConfigForTests();
}

it('withAdmin returns 401 without header and calls through with ADMIN_AUTH=off', async () => {
  process.env.ADMIN_AUTH = 'cloudflare';
  process.env.CF_ACCESS_TEAM_DOMAIN = teamDomain;
  process.env.CF_ACCESS_AUD = aud;
  resetConfigForTests();
  const h = withAdmin(async () => new Response('ok'));
  expect((await h(new Request('http://x/api/admin/videos'), {})).status).toBe(401);
  process.env.ADMIN_AUTH = 'off';
  resetConfigForTests();
  expect(await (await h(new Request('http://x/api/admin/videos'), {})).text()).toBe('ok');
});

it('the 401 gives no detail and does not run the handler', async () => {
  cloudflare();
  const handler = vi.fn(async () => new Response('secret'));
  const res = await withAdmin(handler)(
    new Request('http://x/api/admin/videos', {
      headers: { 'Cf-Access-Jwt-Assertion': 'not.a.jwt' },
    }),
    {}
  );
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: 'unauthorised' });
  expect(res.headers.get('content-type')).toMatch(/application\/json/);
  expect(handler).not.toHaveBeenCalled();
});

it('fails closed when cloudflare mode has no team domain or audience', async () => {
  process.env.ADMIN_AUTH = 'cloudflare';
  delete process.env.CF_ACCESS_TEAM_DOMAIN;
  delete process.env.CF_ACCESS_AUD;
  resetConfigForTests();
  const got = await checkAdmin(
    new Request('http://x/', { headers: { 'Cf-Access-Jwt-Assertion': 'a.b.c' } })
  );
  expect(got.ok).toBe(false);
});

it('accepts a valid token and passes the request and context through', async () => {
  cloudflare();
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwks = createLocalJWKSet({
    keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }],
  });
  const jwt = await new SignJWT({ email: 'tim@example.com' })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(`https://${teamDomain}`)
    .setAudience(aud)
    .setSubject('u1')
    .setExpirationTime('5m')
    .sign(privateKey);
  const req = new Request('http://x/', { headers: { 'cf-access-jwt-assertion': jwt } });
  const got = await checkAdmin(req, { jwks });
  expect(got).toEqual({
    ok: true,
    identity: { email: 'tim@example.com', serviceToken: false, sub: 'u1' },
  });
  const h = withAdmin(async (r: Request, ctx: { n: number }) => new Response(`${r.url} ${ctx.n}`), {
    jwks,
  });
  expect(await (await h(req, { n: 7 })).text()).toBe('http://x/ 7');
});

it('ADMIN_AUTH=off gives a null identity', async () => {
  process.env.ADMIN_AUTH = 'off';
  resetConfigForTests();
  expect(await checkAdmin(new Request('http://x/'))).toEqual({ ok: true, identity: null });
});

describe('requireAdminPage', () => {
  it('calls notFound() when there is no valid token', async () => {
    cloudflare();
    const { requireAdminPage } = await import('./guard');
    await expect(requireAdminPage()).rejects.toThrow('NEXT_NOT_FOUND');
    mocks.headers.mockResolvedValueOnce(new Headers({ 'cf-access-jwt-assertion': 'a.b.c' }));
    await expect(requireAdminPage()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('returns null with ADMIN_AUTH=off', async () => {
    process.env.ADMIN_AUTH = 'off';
    resetConfigForTests();
    const { requireAdminPage } = await import('./guard');
    expect(await requireAdminPage()).toBeNull();
  });
});
