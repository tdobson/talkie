import type { StepName } from '@/lib/types';
import { assembleStep } from './assemble';
import { momentsStep } from './moments';
import { silenceStep } from './silence';
import { transcribeStep } from './transcribe';
import type { StepFn } from './types';

export type { StepContext, StepFn } from './types';
export { audioFileName, EmptyCommentError, FILES, isStepName, STEP_ORDER } from './types';

// Rendering lives in lib/render and has its own steps (lib/pipeline/steps/stills.ts and
// clip.ts). Until those are wired in here, the two render steps fail with a clear message.
const notWired: StepFn = async () => {
  throw new Error('render not wired');
};

/**
 * The step registry the processor runs from. It is a plain mutable map so the render steps
 * can be swapped in (and tests can stub any step).
 */
export const steps: Record<StepName, StepFn> = {
  audio: assembleStep,
  silence: silenceStep,
  transcribe: transcribeStep,
  moments: momentsStep,
  stills: notWired,
  clip: notWired,
};
