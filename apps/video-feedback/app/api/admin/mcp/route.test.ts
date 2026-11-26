import { resetConfigForTests } from '@/lib/config';
import { withTmpData } from '@/test/helpers/tmpData';
import { GET, POST } from './route';

const ENV_KEYS = ['ADMIN_AUTH', 'CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD'];
let saved: Record<string, string | undefined>;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  ({ cleanup } = await withTmpData());
});
afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetConfigForTests();
  await cleanup();
});

const rpc = (headers: Record<string, string> = {}) =>
  new Request('http://x/api/admin/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });

it('needs the admin token, like the rest of the admin API', async () => {
  process.env.ADMIN_AUTH = 'cloudflare';
  process.env.CF_ACCESS_TEAM_DOMAIN = 'team.cloudflareaccess.com';
  process.env.CF_ACCESS_AUD = 'aud';
  resetConfigForTests();
  expect((await POST(rpc())).status).toBe(401);
  expect((await GET(new Request('http://x/api/admin/mcp'))).status).toBe(401);
});

it('lists the tools for an admin, and refuses a request from another site', async () => {
  process.env.ADMIN_AUTH = 'off';
  resetConfigForTests();
  const res = await POST(rpc());
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body.result.tools)).toBe(true);
  expect((await POST(rpc({ Origin: 'https://evil.example' }))).status).toBe(403);
});
