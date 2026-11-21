/**
 * The folder URL of a Talkie version, as served by the film route (Talkie spec section 6):
 * `talkie.json` and every file it lists are fetched relative to this.
 */
export function filmFolderUrl(token: string, version: number): string {
  return `/api/r/${encodeURIComponent(token)}/film/?version=${version}`;
}
