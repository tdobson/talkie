import type { CommentRef } from '@/lib/types';

type Handler = (ref: CommentRef) => void;
let handler: Handler | null = null;

export function setCommentCompleteHandler(h: Handler | null): void {
  handler = h;
}

export function notifyCommentComplete(ref: CommentRef): void {
  handler?.(ref);
}
