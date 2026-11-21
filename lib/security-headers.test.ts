import nextConfig from '../next.config.mjs';

type Rule = { source: string; headers: { key: string; value: string }[] };

/** The headers Next would send for a path, from the rules in next.config.mjs. */
async function headersFor(path: string): Promise<Record<string, string>> {
  const rules = (await nextConfig.headers?.()) as Rule[];
  const out: Record<string, string> = {};
  for (const rule of rules) {
    const prefix = rule.source.replace(/\/:path\*$/, '');
    const matches = rule.source.endsWith('/:path*')
      ? path === prefix || path.startsWith(`${prefix}/`) || prefix === ''
      : path === rule.source;
    if (matches) for (const h of rule.headers) out[h.key] = h.value;
  }
  return out;
}

describe('security headers', () => {
  it('stops every page being framed or sniffed', async () => {
    for (const path of ['/', '/admin', '/admin/inbox', '/r/tok', '/api/admin/videos']) {
      const h = await headersFor(path);
      expect(h['X-Frame-Options']).toBe('DENY');
      expect(h['Content-Security-Policy']).toContain("frame-ancestors 'none'");
      expect(h['X-Content-Type-Options']).toBe('nosniff');
    }
  });

  it('keeps review links out of referrers and search indexes', async () => {
    for (const path of ['/r/tok', '/api/r/tok/video', '/api/admin/videos', '/admin', '/admin/x']) {
      const h = await headersFor(path);
      expect(h['Referrer-Policy']).toBe('no-referrer');
      expect(h['X-Robots-Tag']).toBe('noindex, nofollow');
    }
    expect((await headersFor('/'))['X-Robots-Tag']).toBeUndefined();
  });
});
