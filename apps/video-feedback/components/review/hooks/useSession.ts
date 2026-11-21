'use client';

import { useMemo } from 'react';
import type { CreateSessionResult, GetSessionResult } from '@/lib/types';

export interface SessionApi {
  /** The session this browser started earlier, if the server still knows it. */
  resume: () => Promise<GetSessionResult | null>;
  /** Starts a session and remembers it in this browser. */
  start: (reviewerName: string) => Promise<CreateSessionResult>;
  /** Tells the server the reviewer has finished. The session can still be resumed. */
  finish: (sessionId: string) => Promise<void>;
}

const DONE_ATTEMPTS = 3;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    // Storage can be blocked outright (some private modes): the review still works, unresumed.
    return null;
  }
}

/** Reviewer session calls, plus the session id kept in localStorage under `vf:<token>`. */
export function useSession(token: string): SessionApi {
  return useMemo(() => {
    const key = `vf:${token}`;
    const base = `/api/r/${encodeURIComponent(token)}/sessions`;

    return {
      async resume() {
        const sid = storage()?.getItem(key);
        if (!sid) return null;
        let res: Response;
        try {
          res = await fetch(`${base}/${encodeURIComponent(sid)}`, { cache: 'no-store' });
        } catch {
          // Offline or a server hiccup: keep the id, it may well still be good next time.
          return null;
        }
        if (res.status === 404 || res.status === 400) {
          storage()?.removeItem(key);
          return null;
        }
        if (!res.ok) return null;
        return (await res.json()) as GetSessionResult;
      },

      async start(reviewerName) {
        const res = await fetch(base, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reviewerName, userAgent: navigator.userAgent }),
        });
        if (!res.ok) throw new Error(`Could not start the session: HTTP ${res.status}`);
        const result = (await res.json()) as CreateSessionResult;
        try {
          storage()?.setItem(key, result.sessionId);
        } catch {
          // Storage full or blocked: the session works, it just cannot be resumed.
        }
        return result;
      },

      async finish(sessionId) {
        const url = `${base}/${encodeURIComponent(sessionId)}/done`;
        for (let attempt = 1; ; attempt++) {
          try {
            const res = await fetch(url, { method: 'POST' });
            if (res.ok || (res.status < 500 && res.status !== 429)) return;
          } catch {
            // retried below
          }
          if (attempt >= DONE_ATTEMPTS) return;
          await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
        }
      },
    };
  }, [token]);
}
