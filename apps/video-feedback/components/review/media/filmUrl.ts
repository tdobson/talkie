/**
 * The folder URL of a Talkie version, as served by the film route: `talkie.json` and every file
 * it lists are fetched relative to this.
 *
 * The version is a path segment, not a query string. The engine and `openFilm` resolve each file
 * with `new URL(path, folder)`, which keeps the folder's path and drops its query, so a
 * `?version=` here would be lost on every request.
 */
export function filmFolderUrl(token: string, version: number): string {
  return `/api/r/${encodeURIComponent(token)}/film/${version}/`;
}
