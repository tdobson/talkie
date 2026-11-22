'use client';

import { useEffect, useState } from 'react';

/**
 * True for `showMs` once `active` has stayed true for `afterMs`, then false again for another
 * `afterMs` before it can come back. So while the film plays with no pause, the hint shows at
 * most once a minute (with the default timings), and any pause starts the wait again.
 */
export function useIdleHint(active: boolean, afterMs: number, showMs: number): boolean {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    setShown(false);
    if (!active) return;
    let timer: ReturnType<typeof setTimeout>;
    const wait = () => {
      timer = setTimeout(() => {
        setShown(true);
        timer = setTimeout(() => {
          setShown(false);
          wait();
        }, showMs);
      }, afterMs);
    };
    wait();
    return () => clearTimeout(timer);
  }, [active, afterMs, showMs]);

  return shown;
}
