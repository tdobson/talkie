import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Command, Option } from 'commander';
import { readWav } from '../audio/wav';
import { loadConfig, type LoadOptions, type ResolvedConfig } from '../config';
import { lineIdentity, readScript, sceneOrder } from '../project';
import { lineHash, readVoice, writeVoice } from '../voice-cache';
import { providerFor, type ProviderId, type VoiceProvider } from '../voice/provider';
import { MIN_SIMILARITY, transcribe, wordSimilarity } from '../voice/whisper';

export interface VoiceOptions extends LoadOptions {
  /** Voice with this provider instead of the one in the config. */
  provider?: ProviderId;
  /** Voice the lines of this scene only. */
  only?: string;
  /** Listen to every line with Whisper and flag the likely misreads. */
  check?: boolean;
  /** Stand-in providers by id, for tests. */
  providers?: Partial<Record<ProviderId, VoiceProvider>>;
  /** Stand-in for Whisper, for tests. */
  transcribe?: (wav: Uint8Array) => Promise<string>;
}

export interface VoiceRow {
  scene: string;
  id: string;
  /** `new` when the line was voiced in this run, `cached` when its voice was already current. */
  state: 'new' | 'cached';
  seconds: number;
  /** With a check: how alike the script and the transcript are, from 0 to 1. */
  similarity?: number;
  /** With a check: what Whisper heard. */
  heard?: string;
  flagged: boolean;
}

export interface VoiceResult {
  provider: ProviderId;
  /** The provider the config names, which is the one `talkie build` reads voices for. */
  configProvider: ProviderId;
  checked: boolean;
  rows: VoiceRow[];
}

/**
 * Voice the lines of a film project that have no current voice. A line is current while its
 * provider, voice, prompt and spoken text (the script text after the lexicon) are unchanged.
 */
export async function voiceFilm(dir: string, options: VoiceOptions = {}): Promise<VoiceResult> {
  const projectDir = resolve(dir);
  const loaded = await loadConfig(projectDir, options.alias ? { alias: options.alias } : {});
  const providerId = options.provider ?? loaded.voice.provider;
  const config: ResolvedConfig = { ...loaded, voice: { ...loaded.voice, provider: providerId } };
  const scenes = sceneOrder(config);
  if (options.only !== undefined && !scenes.includes(options.only)) {
    throw new Error(`the film has no scene called ${options.only}. It has: ${scenes.join(', ')}`);
  }
  const provider = options.providers?.[providerId] ?? providerFor(providerId);
  const listen = options.transcribe ?? ((wav: Uint8Array) => transcribe(wav));
  const rows: VoiceRow[] = [];
  for (const scene of scenes) {
    if (options.only !== undefined && scene !== options.only) {
      continue;
    }
    const script = await readScript(projectDir, scene);
    for (const line of script.lines) {
      const identity = lineIdentity(config, line.text);
      const hash = lineHash(identity);
      let voiced = await readVoice(projectDir, line.id, hash);
      const state = voiced ? 'cached' : 'new';
      let wav: Uint8Array | undefined;
      if (!voiced) {
        wav = await provider.synthesize(identity.spokenText, {
          voice: identity.voice,
          prompt: identity.prompt,
        });
        const { samples, sampleRate } = readWav(wav);
        const seconds = Math.round((samples.length / sampleRate) * 1e6) / 1e6;
        voiced = await writeVoice(projectDir, line.id, { hash, wav, seconds, text: line.text });
      }
      const row: VoiceRow = { scene, id: line.id, state, seconds: voiced.seconds, flagged: false };
      if (options.check) {
        const heard = await listen(wav ?? (await readFile(voiced.file)));
        // Whisper may write the word as it is spelt ("PV") or as it was respelt ("P V")
        row.similarity = Math.max(
          wordSimilarity(line.text, heard),
          wordSimilarity(identity.spokenText, heard)
        );
        row.heard = heard;
        row.flagged = row.similarity < MIN_SIMILARITY;
      }
      rows.push(row);
    }
  }
  return {
    provider: providerId,
    configProvider: loaded.voice.provider,
    checked: options.check === true,
    rows,
  };
}

/** The table `talkie voice` prints: one row per line, then the counts. */
export function voiceTable({ rows, checked }: VoiceResult): string {
  const cells = rows.map((row) => [
    row.id,
    row.scene,
    row.state,
    row.seconds.toFixed(2),
    ...(checked ? [`${(row.similarity ?? 0).toFixed(2)} ${row.flagged ? 'FLAG' : 'ok'}`] : []),
    ...(checked ? [row.flagged ? `heard: ${row.heard ?? ''}` : ''] : []),
  ]);
  const head = ['line', 'scene', 'state', 'seconds', ...(checked ? ['check', ''] : [])];
  const table = [head, ...cells];
  const widths = head.map((_, column) => Math.max(...table.map((cell) => cell[column].length)));
  const lines = table.map((cell) =>
    cell
      .map((text, column) => text.padEnd(widths[column]))
      .join('  ')
      .trimEnd()
  );
  const count = (state: VoiceRow['state']) => rows.filter((row) => row.state === state).length;
  const flagged = rows.filter((row) => row.flagged).length;
  lines.push(
    `${count('new')} new, ${count('cached')} cached${checked ? `, ${flagged} flagged` : ''}`
  );
  return `${lines.join('\n')}\n`;
}

export const voiceCommand = new Command('voice')
  .description('Voice the script lines of a film project that have no current voice')
  .argument('[dir]', 'the film project folder', '.')
  .addOption(
    new Option('--provider <provider>', 'voice provider, instead of the one in the config').choices(
      ['fake', 'openrouter']
    )
  )
  .option('--only <sceneId>', 'voice the lines of one scene only')
  .option('--check', 'listen to every line with Whisper and flag likely misreads')
  .action(
    async (dir: string, options: { provider?: ProviderId; only?: string; check?: boolean }) => {
      const result = await voiceFilm(dir, {
        ...(options.provider ? { provider: options.provider } : {}),
        ...(options.only === undefined ? {} : { only: options.only }),
        check: options.check === true,
      });
      process.stdout.write(voiceTable(result));
      if (result.provider !== result.configProvider) {
        process.stdout.write(
          `Voiced with ${result.provider}, but the config names ${result.configProvider}: talkie build reads the voices of the provider in the config.\n`
        );
      }
      const flagged = result.rows.filter((row) => row.flagged).map((row) => row.id);
      if (flagged.length > 0) {
        const count = flagged.length === 1 ? '1 line was' : `${flagged.length} lines were`;
        // bin.ts prints the message and exits 1
        throw new Error(
          `${count} heard differently from the script: ${flagged.join(', ')}. Listen to each, then fix the lexicon or the script.`
        );
      }
    }
  );
