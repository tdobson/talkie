import { join } from 'node:path';
import { detectSpeech } from '@/lib/media/ops';
import { EmptyCommentError, FILES, type StepFn } from './types';

/**
 * The `silence` step: a recording with no speech is not worth transcribing or rendering.
 * It throws `EmptyCommentError`, which the processor turns into state `empty`.
 */
export const silenceStep: StepFn = async ({ dir, log }) => {
  const { hasSpeech, speechSeconds } = await detectSpeech(join(dir, FILES.wav));
  log(`${speechSeconds.toFixed(1)}s of sound`);
  if (!hasSpeech) throw new EmptyCommentError();
};
