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

const prod = {
  NODE_ENV: 'production',
  CF_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
  CF_ACCESS_AUD: 'aud',
  PUBLIC_BASE_URL: 'https://feedback.example.com/',
  GROQ_API_KEY: 'gsk_test',
};

it('loads a complete production config', () => {
  const c = loadConfig(prod);
  expect(c.isProduction).toBe(true);
  expect(c.publicBaseUrl).toBe('https://feedback.example.com');
  expect(c.transcriber).toBe('groq');
});
it('defaults PUBLIC_BASE_URL to localhost outside production', () => {
  expect(loadConfig({}).publicBaseUrl).toBe('http://localhost:3000');
});
it('requires PUBLIC_BASE_URL in production', () => {
  expect(() => loadConfig({ ...prod, PUBLIC_BASE_URL: undefined })).toThrow(/PUBLIC_BASE_URL/);
  expect(() => loadConfig({ ...prod, PUBLIC_BASE_URL: '  ' })).toThrow(/PUBLIC_BASE_URL/);
});
it('requires GROQ_API_KEY when the transcriber is groq in production', () => {
  expect(() => loadConfig({ ...prod, GROQ_API_KEY: undefined })).toThrow(/GROQ_API_KEY/);
  expect(() => loadConfig({ ...prod, GROQ_API_KEY: undefined, TRANSCRIBER: 'groq' })).toThrow(
    /GROQ_API_KEY/
  );
});
it('does not require GROQ_API_KEY outside production', () => {
  expect(loadConfig({}).groqApiKey).toBeNull();
});
it('refuses TRANSCRIBER=fake in production', () => {
  expect(() => loadConfig({ ...prod, TRANSCRIBER: 'fake' })).toThrow(/TRANSCRIBER=fake/);
  expect(() => loadConfig({ ...prod, TRANSCRIBER: 'fake', E2E_TEST_MODE: '0' })).toThrow(
    /TRANSCRIBER=fake/
  );
});
it('allows TRANSCRIBER=fake in production only with E2E_TEST_MODE=1, without a Groq key', () => {
  const c = loadConfig({
    ...prod,
    GROQ_API_KEY: undefined,
    TRANSCRIBER: 'fake',
    E2E_TEST_MODE: '1',
  });
  expect(c.transcriber).toBe('fake');
  expect(c.groqApiKey).toBeNull();
});
