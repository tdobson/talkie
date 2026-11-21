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

  it('deploy unit runs from apps/video-feedback', () => {
    expect(text(join(app, 'deploy', 'video-feedback.service'))).toMatch(
      /^WorkingDirectory=.*\/apps\/video-feedback$/m
    );
  });

  it('deploy unit starts the standalone server of the workspace', () => {
    const unit = text(join(app, 'deploy', 'video-feedback.service'));
    expect(unit).toMatch(/^ExecStart=\S+ \.next\/standalone\/apps\/video-feedback\/server\.js$/m);
    expect(unit).toContain('playwright install chromium');
  });

  // Task 6.1 contract: the docs describe the monorepo checkout and Chromium for Talkie stills.
  it('DEPLOY.md builds from the root and installs Chromium at low priority', () => {
    const deploy = text(join(root, 'docs', 'DEPLOY.md'));
    expect(deploy).toContain('yarn vf build');
    expect(deploy).toContain('ionice -c2 -n7 nice -n19 yarn vf playwright install chromium');
    expect(deploy).toContain('--with-deps');
    expect(deploy).toContain('talkie-mini.lottie');
    expect(deploy).toContain('apps/video-feedback/.next/standalone/apps/video-feedback');
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
