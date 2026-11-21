import type { CommentRef } from '@/lib/types';

type Handler = (ref: CommentRef) => void;

// Next.js may bundle instrumentation.ts (which sets the handler) separately from the route
// handlers (which call it), giving each its own copy of this module. The handler is kept on
// globalThis so both copies see the same one.
const HANDLER_KEY = Symbol.for('video-feedback.commentCompleteHandler');
type HandlerHolder = typeof globalThis & { [HANDLER_KEY]?: Handler | null };

export function setCommentCompleteHandler(h: Handler | null): void {
  (globalThis as HandlerHolder)[HANDLER_KEY] = h;
}

export function notifyCommentComplete(ref: CommentRef): void {
  (globalThis as HandlerHolder)[HANDLER_KEY]?.(ref);
}
