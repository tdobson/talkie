import type { StepName } from '@/lib/types';
import { assembleStep } from './assemble';
import { clipStep } from './clip';
import { momentsStep } from './moments';
import { silenceStep } from './silence';
import { stillsStep } from './stills';
import { transcribeStep } from './transcribe';
import type { StepFn } from './types';

export type { StepContext, StepFn } from './types';
export { audioFileName, EmptyCommentError, FILES, isStepName, STEP_ORDER } from './types';

/**
 * The step registry the processor runs from. It is a plain mutable map so tests can stub any
 * step. The stills and clip steps call into lib/render.
 */
export const steps: Record<StepName, StepFn> = {
  audio: assembleStep,
  silence: silenceStep,
  transcribe: transcribeStep,
  moments: momentsStep,
  stills: stillsStep,
  clip: clipStep,
};
