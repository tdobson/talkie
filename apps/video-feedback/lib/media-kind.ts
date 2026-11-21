import type { MediaKind, VersionRecord } from '@/lib/types';

export function mediaKindOf(v: Pick<VersionRecord, 'mediaKind'>): MediaKind {
  return v.mediaKind ?? 'mp4';
}
