export type TalkieErrorCode =
  | 'invalid-film'
  | 'unsupported-version'
  | 'no-playable-audio'
  | 'network'
  | 'scene-failed';

export class TalkieError extends Error {
  constructor(
    public readonly code: TalkieErrorCode,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'TalkieError';
  }
}
