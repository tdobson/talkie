import { fakeProvider } from './fake';
import { openRouterProvider } from './openrouter';

/** Something that turns the spoken text of one line into a PCM16 mono WAV. */
export interface VoiceProvider {
  id: string;
  synthesize(spokenText: string, o: { voice: string; prompt: string }): Promise<Uint8Array>;
}

export type ProviderId = 'openrouter' | 'fake';

/** The provider a config or `--provider` names. */
export function providerFor(id: ProviderId): VoiceProvider {
  return id === 'fake' ? fakeProvider : openRouterProvider();
}
