import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { defineConfig, loadConfig } from '../src/config';
import { artLoaders, lineIdentity, readScript, sceneOrder, spokenText } from '../src/project';

const FIXTURE = resolve(__dirname, 'fixtures/mini-film');
const ALIAS = { '@talkie/cli': resolve(__dirname, '../src/config.ts') };

let dir = '';
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'talkie-config-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const writeConfig = (body: string) =>
  writeFile(join(dir, 'talkie.config.ts'), `export default ${body};\n`);

test('defineConfig returns what it is given', () => {
  const config = { title: 'A', chapters: [{ title: 'One', scenes: ['a'] }] };
  expect(defineConfig(config)).toBe(config);
});

test('loadConfig reads talkie.config.ts and fills in the defaults', async () => {
  const config = await loadConfig(FIXTURE, { alias: ALIAS });
  expect(config).toEqual({
    title: 'Mini film',
    size: [320, 180],
    chapters: [
      { title: 'The tile', scenes: ['one'] },
      { title: 'The nail', scenes: ['two'] },
    ],
    voice: { provider: 'fake', voice: 'test', prompt: 'calm', lexicon: { soffit: 'soff it' } },
    font: 'fonts/label.ttf',
    conflicts: ['345 mm'],
    timing: {},
    captionsLang: 'en',
  });
  expect(sceneOrder(config)).toEqual(['one', 'two']);
});

test('a bare config gets 1920 x 1080, English captions and the default voice', async () => {
  await writeConfig(`{ title: 'Bare', chapters: [{ title: 'Only', scenes: ['a', 'b'] }] }`);
  const config = await loadConfig(dir);
  expect(config.size).toEqual([1920, 1080]);
  expect(config.captionsLang).toBe('en');
  expect(config.voice.provider).toBe('openrouter');
  expect(config.voice.voice).toBe('ballad');
  expect(config.voice.lexicon).toEqual({});
  expect(config.conflicts).toEqual([]);
});

test('loadConfig says what is wrong with a config', async () => {
  await expect(loadConfig(dir)).rejects.toThrow('no talkie.config.ts in');
  await writeConfig(`{ chapters: [{ title: 'Only', scenes: ['a'] }] }`);
  await expect(loadConfig(dir)).rejects.toThrow('title must be a non-empty string');
  await writeConfig(`{ title: 'T', chapters: [] }`);
  await expect(loadConfig(dir)).rejects.toThrow('chapters must list at least one chapter');
  await writeConfig(`{ title: 'T', chapters: [{ title: 'Only', scenes: [] }] }`);
  await expect(loadConfig(dir)).rejects.toThrow('chapter "Only" has no scenes');
  await writeConfig(
    `{ title: 'T', chapters: [{ title: 'A', scenes: ['a'] }, { title: 'B', scenes: ['a'] }] }`
  );
  await expect(loadConfig(dir)).rejects.toThrow('scene a is listed twice');
  await writeConfig(`{ title: 'T', chapters: [{ title: 'A', scenes: ['../a'] }] }`);
  await expect(loadConfig(dir)).rejects.toThrow('scene id "../a"');
  await writeConfig(
    `{ title: 'T', size: [320.5, 180], chapters: [{ title: 'A', scenes: ['a'] }] }`
  );
  await expect(loadConfig(dir)).rejects.toThrow('size must be [width, height] in whole pixels');
  await writeConfig(
    `{ title: 'T', captionsLang: 'en/../x', chapters: [{ title: 'A', scenes: ['a'] }] }`
  );
  await expect(loadConfig(dir)).rejects.toThrow('captionsLang');
});

test('readScript reads the lines and rejects a script it cannot use', async () => {
  const script = await readScript(FIXTURE, 'two');
  expect(script.lines).toEqual([{ id: 'two-a', text: 'One nail holds it down.' }]);
  expect(script.minDuration).toBe(8);

  await expect(readScript(dir, 'a')).rejects.toThrow('scene a has no script (script/a.json)');
  await mkdir(join(dir, 'script'));
  await writeFile(join(dir, 'script/a.json'), '{ nope');
  await expect(readScript(dir, 'a')).rejects.toThrow('script/a.json is not valid JSON');
  await writeFile(join(dir, 'script/a.json'), '{ "lines": [{ "id": "x" }] }');
  await expect(readScript(dir, 'a')).rejects.toThrow(
    'script/a.json: line 1 needs an id and a text'
  );
  await writeFile(join(dir, 'script/a.json'), '{ "lines": [] }');
  await expect(readScript(dir, 'a')).rejects.toThrow('script/a.json has no lines');
});

test('spokenText respells whole words whatever their case, and nothing else', () => {
  const lexicon = { soffit: 'soff it', 'lead flashing': 'led flashing', lead: 'led' };
  expect(spokenText('The Soffit and the soffits.', lexicon)).toBe('The soff it and the soffits.');
  expect(spokenText('Lead flashing, then lead. Leading.', lexicon)).toBe(
    'led flashing, then led. Leading.'
  );
  expect(spokenText('Nothing to change.', {})).toBe('Nothing to change.');
});

test('lineIdentity is what the voice cache hashes: provider, voice, prompt and the spoken text', async () => {
  const config = await loadConfig(FIXTURE, { alias: ALIAS });
  expect(lineIdentity(config, 'It sits under the soffit.')).toEqual({
    provider: 'fake',
    voice: 'test',
    prompt: 'calm',
    spokenText: 'It sits under the soff it.',
  });
});

test('art is found by its path under art/, without the extension, and every use is recorded', async () => {
  const config = await loadConfig(FIXTURE, { alias: ALIAS });
  const { loaders, used } = artLoaders(FIXTURE, config);
  expect(loaders.svg('marks/dot')).toContain('id="nail"');
  expect(loaders.svg('tile')).toContain('id="tile"');
  expect(loaders.font().byteLength).toBeGreaterThan(1000);
  expect([...used.art.keys()]).toEqual(['marks/dot', 'tile']);
  expect(used.font).toMatch(/^[0-9a-f]{64}$/);
  expect(() => loaders.svg('missing')).toThrow('no drawing called "missing" (art/missing.svg)');
  expect(() => loaders.svg('../script/one')).toThrow('art name "../script/one"');
});
