import { loadConfig } from './config';

it('applies defaults', () => {
  const c = loadConfig({});
  expect(c.dataDir).toMatch(/data$/);
  expect(c.whisperLanguage).toBe('en');
  expect(c.adminAuth).toBe('cloudflare');
  expect(c.transcriber).toBe('groq');
});
it('refuses ADMIN_AUTH=off in production', () => {
  expect(() => loadConfig({ ADMIN_AUTH: 'off', NODE_ENV: 'production' })).toThrow(/ADMIN_AUTH=off/);
});
it('requires CF settings when adminAuth is cloudflare in production', () => {
  expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/CF_ACCESS_TEAM_DOMAIN/);
});
it('accepts TRANSCRIBER=fake for tests', () => {
  expect(loadConfig({ TRANSCRIBER: 'fake' }).transcriber).toBe('fake');
});
