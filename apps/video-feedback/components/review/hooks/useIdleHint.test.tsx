import { act, renderHook } from '@/test/helpers/render';
import { useIdleHint } from './useIdleHint';

describe('useIdleHint', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const advance = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });

  it('shows after the wait, for its time, then waits again', () => {
    const { result } = renderHook(() => useIdleHint(true, 60_000, 4000));
    expect(result.current).toBe(false);
    advance(59_999);
    expect(result.current).toBe(false);
    advance(1);
    expect(result.current).toBe(true);
    advance(4000);
    expect(result.current).toBe(false);
    advance(59_999);
    expect(result.current).toBe(false);
    advance(1);
    expect(result.current).toBe(true);
  });

  it('never shows while inactive, and a pause starts the wait again', () => {
    const { result, rerender } = renderHook(({ on }) => useIdleHint(on, 60_000, 4000), {
      initialProps: { on: false },
    });
    advance(120_000);
    expect(result.current).toBe(false);
    rerender({ on: true });
    advance(50_000);
    rerender({ on: false });
    rerender({ on: true });
    advance(50_000);
    expect(result.current).toBe(false);
    advance(10_000);
    expect(result.current).toBe(true);
    rerender({ on: false });
    expect(result.current).toBe(false);
  });
});
