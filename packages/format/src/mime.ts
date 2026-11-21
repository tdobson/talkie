const TYPES = new Map<string, string>([
  ['json', 'application/json'],
  ['vtt', 'text/vtt'],
  ['svg', 'image/svg+xml'],
  ['png', 'image/png'],
  ['webm', 'audio/webm'],
  ['ogg', 'audio/ogg'],
  ['opus', 'audio/ogg'],
  ['m4a', 'audio/mp4'],
]);

/** MIME type for a film file, from its extension. */
export const mimeFor = (path: string): string =>
  TYPES.get(path.split('.').pop()!.toLowerCase()) ?? 'application/octet-stream';
