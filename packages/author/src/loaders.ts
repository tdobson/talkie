/**
 * How a scene reaches files. The caller supplies these (the CLI reads from disk, tests read
 * fixtures), so this package never touches the file system itself.
 */
export interface Loaders {
  /** The text of an SVG drawing from the project's art library, by name. */
  svg(name: string): string;
  /** The bytes of the TTF or OTF font that labels are outlined with. */
  font(): ArrayBuffer;
}
