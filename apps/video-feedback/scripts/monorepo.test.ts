import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Task 1.1 contract: the app lives in apps/video-feedback inside the Talkie monorepo.
const app = join(import.meta.dirname, '..');
const root = join(app, '..', '..');
const json = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const text = (p: string) => readFileSync(p, 'utf8');

describe('monorepo layout', () => {
  const rootPkg = json(join(root, 'package.json'));
  const appPkg = json(join(app, 'package.json'));

  it('root manifest lists apps/* and the check and vf scripts', () => {
    expect(rootPkg.workspaces).toContain('apps/*');
    expect(rootPkg.scripts.check).toBe('yarn test && yarn workspace video-feedback check');
    expect(rootPkg.scripts.vf).toBe('yarn workspace video-feedback');
  });

  it('app keeps its name and depends on the Talkie packages and playwright-core', () => {
    expect(appPkg.name).toBe('video-feedback');
    expect(appPkg.dependencies['@talkie/format']).toBe('workspace:*');
    expect(appPkg.dependencies['@talkie/player']).toBe('workspace:*');
    expect(appPkg.dependencies['playwright-core']).toBeDefined();
  });

  it('build, dev and test:e2e build the Talkie dependencies first', () => {
    expect(appPkg.scripts.predeps).toMatch(
      /foreach -Rpt --from video-feedback --exclude video-feedback run build/
    );
    for (const s of ['build', 'dev', 'test:e2e'])
      expect(appPkg.scripts[s]).toMatch(/^yarn predeps && /);
  });

  it('tsconfig maps @talkie/* to the package sources', () => {
    expect(text(join(app, 'tsconfig.json'))).toContain('"@talkie/*": ["../../packages/*/src"]');
  });

  it('root tool configs ignore apps/**', () => {
    expect(text(join(root, 'playwright.config.ts'))).toContain("'apps/**'");
    expect(text(join(root, 'jest.config.cjs'))).toContain('<rootDir>/apps/');
  });

  it('deploy slots run the standalone server of their release, from apps/video-feedback', () => {
    const unit = text(join(app, 'deploy', 'video-feedback@.service'));
    expect(unit).toMatch(
      /^WorkingDirectory=\/srv\/video-feedback\/slot-%i\/apps\/video-feedback$/m
    );
    expect(unit).toMatch(/^ExecStart=\S+ server\.js$/m);
    expect(unit).toMatch(/^Environment=.*PORT=%i/m);
    expect(unit).toContain('TALKIE_CHROMIUM_PATH');
  });

  it('the front proxy listens where the tunnel points and reads the live slot from a file', () => {
    const caddy = text(join(app, 'deploy', 'Caddyfile'));
    expect(caddy).toContain('http://:3000');
    expect(caddy).toContain('bind 127.0.0.1');
    expect(caddy).toContain('import /srv/video-feedback/proxy/upstream.caddy');
    // Its own admin socket: there is another Caddy on the host, on the default admin port.
    expect(caddy).toContain('admin unix//srv/video-feedback/proxy/admin.sock');
  });

  // The docs describe the one-command deploy and Chromium for Talkie stills.
  it('DEPLOY.md deploys with the script and covers Chromium and the old CPU', () => {
    const deploy = text(join(root, 'docs', 'DEPLOY.md'));
    expect(deploy).toContain('scripts/deploy/video-feedback.sh');
    expect(deploy).toContain('yarn vf build');
    expect(deploy).toContain('TALKIE_CHROMIUM_PATH');
    expect(deploy).toContain('sharp-old-cpu.sh');
    expect(deploy).toContain('talkie-mini.lottie');
    expect(deploy).not.toMatch(/[\u2013\u2014]/);
  });

  it('root README shows the layout and the gate commands', () => {
    const readme = text(join(root, 'README.md'));
    for (const s of [
      'apps/video-feedback',
      'packages/',
      'yarn check',
      'yarn vf build',
      'yarn vf test:e2e',
    ])
      expect(readme).toContain(s);
    expect(readme).toMatch(/^## Layout$/m);
    expect(readme).not.toMatch(/[\u2013\u2014]/);
  });
});
