import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { compileScene, scene, type SceneContext, type SceneModel } from '@talkie/author';
import { writeWav } from '../src/audio/wav';
import { qaCommand } from '../src/commands/qa';
import { loadConfig } from '../src/config';
import { lineIdentity, readScript, sceneOrder } from '../src/project';
import {
  bandGate,
  captionGate,
  dashGate,
  loudnessGates,
  sizeReport,
  stillGate,
  voiceGate,
} from '../src/qa/gates';
import { formatQa } from '../src/qa/report';
import { runQa } from '../src/qa/run';
import { lineHash, writeVoice } from '../src/voice-cache';

jest.setTimeout(180_000);

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
// without ffmpeg these show as skipped under the title below
const describeFfmpeg = hasFfmpeg ? describe : describe.skip;

const EM = '\u2014';
const EN = '\u2013';

const model = (
  fn: (ctx: SceneContext) => void,
  duration: number,
  size: [number, number] = [1920, 1080]
): SceneModel => compileScene(scene('s', fn), { size, lines: [], duration });
const box = (ctx: SceneContext, y: number, name: string) =>
  ctx.rect(100, y, 40, 20, { fill: '#000000' }, name);

describe('gates', () => {
  test('voice passes with no problems and lists them otherwise', () => {
    expect(voiceGate([])).toEqual({ name: 'voice', status: 'PASS', details: [] });
    expect(voiceGate(['line a: no voice'])).toEqual({
      name: 'voice',
      status: 'FAIL',
      details: ['line a: no voice'],
    });
  });

  test('dashes finds em and en dashes and says where', () => {
    expect(dashGate([{ where: 'script one, line a', text: 'A plain-hyphen line.' }]).status).toBe(
      'PASS'
    );
    const gate = dashGate([
      { where: 'script one, line a', text: `Wait ${EM} what?` },
      { where: 'scene one, label', text: `120${EN}150 mm` },
      { where: 'script one, line b', text: 'Fine.' },
    ]);
    expect(gate.name).toBe('dashes');
    expect(gate.status).toBe('FAIL');
    expect(gate.details).toEqual([
      'script one, line a has an em dash: "Wait \u2014 what?"',
      'scene one, label has an en dash: "120\u2013150 mm"',
    ]);
  });

  test('captions fails a chunk of more than 112 characters', () => {
    const short = 'Set the gauge to one hundred millimetres.';
    expect(captionGate([{ id: 'a', text: short }])).toEqual({
      name: 'captions',
      status: 'PASS',
      details: [],
    });
    // no sentence or clause boundary, so the chunker has nowhere to split it
    const long = Array.from({ length: 30 }, () => 'word').join(' ');
    expect(long.length).toBe(149);
    expect(
      captionGate([
        { id: 'a', text: short },
        { id: 'b', text: long },
      ])
    ).toEqual({
      name: 'captions',
      status: 'FAIL',
      details: ['line b: a caption chunk is 149 characters, over 112: "word word word word ..."'],
    });
  });

  test('loudness wants -16 LUFS give or take 1, and true peak at or below -1 dBTP', () => {
    const good = loudnessGates([
      { src: 'u/narration.webm', integrated: -16.9, truePeak: -1 },
      { src: 'u/narration.m4a', integrated: -15.1, truePeak: -3.2 },
    ]);
    expect(good).toEqual([
      {
        name: 'loudness',
        status: 'PASS',
        details: ['u/narration.webm: -16.9 LUFS', 'u/narration.m4a: -15.1 LUFS'],
      },
      {
        name: 'true peak',
        status: 'PASS',
        details: ['u/narration.webm: -1 dBTP', 'u/narration.m4a: -3.2 dBTP'],
      },
    ]);
    const bad = loudnessGates([
      { src: 'u/narration.webm', integrated: -17.3, truePeak: -0.4 },
      { src: 'u/narration.m4a', integrated: -Infinity, truePeak: -Infinity },
    ]);
    expect(bad.map((g) => g.status)).toEqual(['FAIL', 'FAIL']);
    expect(bad[0].details).toEqual([
      'u/narration.webm: -17.3 LUFS, outside -17 to -15',
      'u/narration.m4a: silent',
    ]);
    expect(bad[1].details).toEqual([
      'u/narration.webm: -0.4 dBTP, over -1',
      'u/narration.m4a: silent',
    ]);
    expect(loudnessGates([]).map((g) => g.status)).toEqual(['FAIL', 'FAIL']);
  });

  test('still fails a picture that holds for more than 8 s, leaving out the tail', () => {
    const moving = (duration: number) =>
      model((ctx) => {
        const a = box(ctx, 100, 'a');
        ctx.add(a);
        ctx.fade(a, 1, { dur: 1 });
      }, duration);
    // still from 2 s to the tail at 10 s: 8 s exactly is allowed
    expect(stillGate([{ id: 'one', model: moving(12.2) }], 2.2)).toEqual({
      name: 'still',
      status: 'PASS',
      details: [],
    });
    expect(
      stillGate(
        [
          { id: 'one', model: moving(12.2) },
          { id: 'two', model: moving(14) },
        ],
        2.2
      )
    ).toEqual({
      name: 'still',
      status: 'FAIL',
      details: ['scene two: nothing moves for 9.8 s, from 2 s to 11.8 s'],
    });
  });

  test('caption band scales the line at y 845 of 1080 to the film height', () => {
    const at = (y: number, size: [number, number]) =>
      model((ctx) => ctx.add(box(ctx, y, 'plate')), 5, size);
    expect(bandGate([{ id: 'one', model: at(820, [1920, 1080]) }]).status).toBe('PASS');
    expect(bandGate([{ id: 'one', model: at(830, [1920, 1080]) }])).toEqual({
      name: 'caption band',
      status: 'FAIL',
      details: ['scene one: "plate" (n1) reaches y 850 at 0 s, into the caption band below y 845'],
    });
    // 180 high: the line is at 140.8
    expect(bandGate([{ id: 'one', model: at(100, [320, 180]) }]).status).toBe('PASS');
    expect(bandGate([{ id: 'one', model: at(125, [320, 180]) }]).details).toEqual([
      'scene one: "plate" (n1) reaches y 145 at 0 s, into the caption band below y 140.8',
    ]);
  });

  test('size reports animation, each audio track, the total and megabytes a minute', () => {
    expect(
      sizeReport({
        animation: 250_000,
        scenes: 3,
        audio: [
          { src: 'u/narration.webm', bytes: 750_000 },
          { src: 'u/narration.m4a', bytes: 1_250_000 },
        ],
        duration: 120,
      })
    ).toEqual({
      name: 'size',
      status: 'INFO',
      details: [
        'animation: 250.0 kB after brotli (3 scenes)',
        'u/narration.webm: 750.0 kB, total 1.00 MB, 0.50 MB per minute',
        'u/narration.m4a: 1250.0 kB, total 1.50 MB, 0.75 MB per minute',
      ],
    });
  });

  test('the report prints a line for each gate and its details', () => {
    expect(
      formatQa([
        { name: 'check', status: 'PASS', details: [] },
        { name: 'voice', status: 'FAIL', details: ['line a: no voice'] },
        { name: 'size', status: 'INFO', details: ['animation: 1.0 kB after brotli (1 scene)'] },
      ])
    ).toBe(
      [
        'PASS  check',
        'FAIL  voice',
        '      line a: no voice',
        'INFO  size',
        '      animation: 1.0 kB after brotli (1 scene)',
        '',
      ].join('\n')
    );
  });
});

const FIXTURE = resolve(__dirname, 'fixtures/mini-film');
/** The fixture is built in a temp folder, where the workspace packages cannot be found by name. */
const ALIAS = {
  '@talkie/author': resolve(__dirname, '../../author/src/index.ts'),
  '@talkie/cli': resolve(__dirname, '../src/config.ts'),
};
const RATE = 48000;

/** One second of a quiet tone; each line gets its own pitch. */
const sine = (hz: number) =>
  writeWav(
    Int16Array.from({ length: RATE }, (_, i) =>
      Math.round(6000 * Math.sin((2 * Math.PI * hz * i) / RATE))
    ),
    RATE
  );

/** Voice every line of the project the way `talkie voice` does: one cache entry per line. */
async function voiceAll(dir: string, skip: string[] = []) {
  const config = await loadConfig(dir, { alias: ALIAS });
  let hz = 220;
  for (const sceneId of sceneOrder(config)) {
    for (const line of (await readScript(dir, sceneId)).lines) {
      hz += 110;
      if (!skip.includes(line.id)) {
        const hash = lineHash(lineIdentity(config, line.text));
        await writeVoice(dir, line.id, { hash, wav: sine(hz), seconds: 1, text: line.text });
      }
    }
  }
}

async function edit(file: string, from: string, to: string) {
  const before = await readFile(file, 'utf8');
  expect(before).toContain(from);
  await writeFile(file, before.replace(from, to));
}

/**
 * The mini-film is 180 high, so its caption band starts at y 140.8. Its tile reaches y 150 and its
 * label sits at y 170. Lift both clear, so the film is one that should pass.
 */
async function clearBand(dir: string) {
  await edit(join(dir, 'scenes/one.ts'), 'at: [40, 30], scale: 2', 'at: [40, 30], scale: 1');
  await edit(join(dir, 'scenes/one.ts'), 'at: [40, 170]', 'at: [40, 120]');
}

const failed = (gates: Array<{ name: string; status: string }>) =>
  gates.filter((gate) => gate.status === 'FAIL').map((gate) => gate.name);

let dir = '';
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'talkie-qa-'));
  await cp(FIXTURE, dir, { recursive: true });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('with no voice and no built film, qa fails voice and what needs the film', async () => {
  await clearBand(dir);
  await voiceAll(dir, ['one-b']);
  const { gates, ok } = await runQa(dir, { alias: ALIAS });
  expect(ok).toBe(false);
  expect(failed(gates)).toEqual(['check', 'voice', 'loudness', 'true peak']);
  expect(gates.find((gate) => gate.name === 'voice')!.details).toEqual(['line one-b: no voice']);
  expect(gates.find((gate) => gate.name === 'size')!.status).toBe('INFO');
});

describeFfmpeg('needs ffmpeg (skipped when ffmpeg is not on the path)', () => {
  test('the mini-film passes every gate, and qa builds it first', async () => {
    await clearBand(dir);
    await voiceAll(dir);
    const { gates, ok } = await runQa(dir, { alias: ALIAS });
    expect(gates.map((gate) => [gate.name, gate.status])).toEqual([
      ['check', 'PASS'],
      ['voice', 'PASS'],
      ['captions', 'PASS'],
      ['dashes', 'PASS'],
      ['loudness', 'PASS'],
      ['true peak', 'PASS'],
      ['still', 'PASS'],
      ['caption band', 'PASS'],
      ['size', 'INFO'],
    ]);
    expect(ok).toBe(true);
    const size = gates.at(-1)!.details;
    expect(size[0]).toMatch(/^animation: \d+\.\d kB after brotli \(2 scenes\)$/);
    expect(size[1]).toMatch(
      /^u\/narration\.webm: \d+\.\d kB, total \d+\.\d\d MB, \d+\.\d\d MB per minute$/
    );
    expect(size[2]).toMatch(/^u\/narration\.m4a: /);

    // the same project gives the same report
    expect(await runQa(dir, { alias: ALIAS })).toEqual({ gates, ok });
  });

  test('the art of the mini-film as it stands is in the caption band, and only that fails', async () => {
    await voiceAll(dir);
    const { gates, ok } = await runQa(dir, { alias: ALIAS });
    expect(ok).toBe(false);
    expect(failed(gates)).toEqual(['caption band']);
    expect(gates.find((gate) => gate.name === 'caption band')!.details).toEqual([
      'scene one: "tile" (n2) reaches y 150 at 1.8 s, into the caption band below y 140.8',
      'scene one: "label Tile" (n3) reaches y 170.2 at 5.667 s, into the caption band below y 140.8',
    ]);
  });

  test('a 10 s still, a dash and a stale line fail exactly those gates', async () => {
    await clearBand(dir);
    // scene two fades its dot in at 1.4 s and then holds: 14 s leaves it still for about 10 s
    await edit(join(dir, 'script/two.json'), '"minDuration": 8', '"minDuration": 14');
    await voiceAll(dir);
    expect((await runQa(dir, { alias: ALIAS })).gates.filter((g) => g.status === 'FAIL')).toEqual([
      {
        name: 'still',
        status: 'FAIL',
        details: ['scene two: nothing moves for 10 s, from 1.8 s to 11.8 s'],
      },
    ]);

    // the words change after the line was voiced, and bring a dash with them
    await edit(
      join(dir, 'script/two.json'),
      'One nail holds',
      `One nail ${EM} just one ${EM} holds`
    );
    const { gates, ok } = await runQa(dir, { alias: ALIAS });
    expect(ok).toBe(false);
    expect(failed(gates)).toEqual(['voice', 'dashes', 'still']);
    expect(gates.find((gate) => gate.name === 'voice')!.details).toEqual([
      'line two-a: the voice is stale',
    ]);
    expect(gates.find((gate) => gate.name === 'dashes')!.details).toEqual([
      `script two, line two-a has an em dash: "One nail ${EM} just one ${EM} holds it down."`,
    ]);
    expect(gates.find((gate) => gate.name === 'still')!.details).toEqual([
      'scene two: nothing moves for 10 s, from 1.8 s to 11.8 s',
    ]);
  });

  test('the qa command prints the report, and fails when a gate fails', async () => {
    await voiceAll(dir);
    const written: string[] = [];
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    const before = process.env.JITI_ALIAS;
    process.env.JITI_ALIAS = JSON.stringify(ALIAS);
    try {
      qaCommand.exitOverride().configureOutput({ writeErr: () => {} });
      await expect(qaCommand.parseAsync([dir], { from: 'user' })).rejects.toThrow(
        'qa: 1 gate failed: caption band'
      );
      expect(written.join('')).toMatch(/^PASS {2}check\nPASS {2}voice\n/);
      expect(written.join('')).toContain('\nFAIL  caption band\n      scene one: "tile"');

      written.length = 0;
      await clearBand(dir);
      await qaCommand.parseAsync([dir], { from: 'user' });
      expect(written.join('')).toMatch(
        /\nPASS {2}caption band\nINFO {2}size\n[^]*\nqa: all gates passed\n$/
      );
    } finally {
      spy.mockRestore();
      if (before === undefined) {
        delete process.env.JITI_ALIAS;
      } else {
        process.env.JITI_ALIAS = before;
      }
    }
  });
});
