import { Resume, resumeKey } from '../../src/ui/resume';

function memory(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}

describe('resumeKey', () => {
  it('uses the src when there is one, else title and duration', () => {
    expect(resumeKey('/films/a/', { title: 'A', duration: 12 })).toBe('talkie:pos:/films/a/');
    expect(resumeKey(null, { title: 'A', duration: 12 })).toBe('talkie:pos:A|12');
  });
});

describe('Resume', () => {
  it('saves every 5 seconds of film time and on pause', () => {
    const storage = memory();
    const r = new Resume('talkie:pos:x', storage);
    r.update(10, 100);
    expect(storage.getItem('talkie:pos:x')).toBe('10');
    r.update(12, 100);
    expect(storage.getItem('talkie:pos:x')).toBe('10');
    r.update(15.1, 100);
    expect(storage.getItem('talkie:pos:x')).toBe('15.1');
    r.save(17, 100);
    expect(storage.getItem('talkie:pos:x')).toBe('17');
    expect(r.read()).toBe(17);
  });

  it('clears within 5 seconds of the end', () => {
    const storage = memory();
    const r = new Resume('talkie:pos:x', storage);
    r.save(50, 100);
    r.save(96, 100);
    expect(storage.getItem('talkie:pos:x')).toBeNull();
    expect(r.read()).toBeNull();
  });

  it('ignores bad stored values', () => {
    const storage = memory();
    storage.setItem('talkie:pos:x', 'soon');
    expect(new Resume('talkie:pos:x', storage).read()).toBeNull();
    storage.setItem('talkie:pos:x', '-4');
    expect(new Resume('talkie:pos:x', storage).read()).toBeNull();
  });

  it('survives storage that throws', () => {
    const boom = () => {
      throw new Error('private mode');
    };
    const storage = { ...memory(), getItem: boom, setItem: boom, removeItem: boom };
    const r = new Resume('talkie:pos:x', storage);
    expect(() => r.save(10, 100)).not.toThrow();
    expect(() => r.save(99, 100)).not.toThrow();
    expect(r.read()).toBeNull();
  });

  it('survives having no storage at all', () => {
    const r = new Resume('talkie:pos:x', null);
    expect(() => r.update(10, 100)).not.toThrow();
    expect(r.read()).toBeNull();
  });
});
