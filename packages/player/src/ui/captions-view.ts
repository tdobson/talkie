import { cueAt, type Cue } from '../engine/vtt';

/** Cue text as plain text: WebVTT tags such as <v Name> and <i> are dropped. */
export function cueText(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

/** Draws the current caption on a plate at the bottom of the stage. */
export class CaptionsView {
  private shown: Cue | null = null;

  constructor(
    private box: HTMLElement,
    private plate: HTMLElement
  ) {}

  /** Show the cue for time `t`, or nothing when captions are off or no cue covers `t`. */
  update(cues: Cue[], t: number, on: boolean): void {
    const cue = on ? cueAt(cues, t) : null;
    if (cue === this.shown) {
      return;
    }
    this.shown = cue;
    this.plate.textContent = cue ? cueText(cue.text) : '';
    this.box.hidden = !cue;
  }
}
