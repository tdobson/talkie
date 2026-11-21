export interface Tap {
  /** Milliseconds, from the event's timeStamp. */
  time: number;
  /** Pixels from the left edge of the stage. */
  x: number;
}

export type TapGesture = 'toggle-controls' | 'skip-back' | 'skip-forward';

export const DOUBLE_TAP_MS = 300;

function third(x: number, width: number): -1 | 0 | 1 {
  if (x < width / 3) {
    return -1;
  }
  return x > (width * 2) / 3 ? 1 : 0;
}

/**
 * Classify a tap given the tap before it. A tap toggles the controls; a second tap within
 * 300 ms on the same outer third of the stage skips 10 s that way.
 */
export function classifyTap(previous: Tap | null, tap: Tap, width: number): TapGesture {
  const side = third(tap.x, width);
  if (
    previous &&
    side !== 0 &&
    tap.time - previous.time <= DOUBLE_TAP_MS &&
    third(previous.x, width) === side
  ) {
    return side < 0 ? 'skip-back' : 'skip-forward';
  }
  return 'toggle-controls';
}

/** Children of the stage that handle their own taps. */
const INTERACTIVE = 'button, .error';

export interface TouchHandlers {
  onToggleControls(): void;
  onSkip(seconds: number): void;
  /** A mouse or pen click on the stage. */
  onClick(): void;
}

/**
 * Wire taps and clicks on the stage. Touch taps go through `classifyTap`; a skip also shows a
 * ripple on that side. Returns a function that removes the listeners.
 */
export function attachTouch(
  stage: HTMLElement,
  ripples: { back: HTMLElement; forward: HTMLElement },
  handlers: TouchHandlers
): () => void {
  let previous: Tap | null = null;
  let touched = false;

  const ripple = (el: HTMLElement) => {
    el.classList.remove('on');
    // Reading a layout property restarts the CSS animation.
    void el.offsetWidth;
    el.classList.add('on');
  };

  // Buttons and the error panel sit on the stage and answer their own taps and clicks.
  const onChild = (event: Event) => {
    const target = event.target;
    return target instanceof Element && target !== stage && target.closest(INTERACTIVE) !== null;
  };

  // A tap that ends without a click (a long press, a scroll) must not swallow the next click.
  const onPointerDown = () => {
    touched = false;
  };

  const onPointerUp = (event: PointerEvent) => {
    if (event.pointerType !== 'touch' || onChild(event)) {
      return;
    }
    touched = true;
    const rect = stage.getBoundingClientRect();
    const tap: Tap = { time: event.timeStamp, x: event.clientX - rect.left };
    const gesture = classifyTap(previous, tap, rect.width);
    // After a skip a third tap skips again, as long as it is quick.
    previous = tap;
    if (gesture === 'skip-back') {
      ripple(ripples.back);
      handlers.onSkip(-10);
    } else if (gesture === 'skip-forward') {
      ripple(ripples.forward);
      handlers.onSkip(10);
    } else {
      handlers.onToggleControls();
    }
  };

  const onClick = (event: Event) => {
    if (onChild(event)) {
      return;
    }
    // Browsers send a click after a touch tap. The tap was already handled.
    if (touched) {
      touched = false;
      return;
    }
    handlers.onClick();
  };

  stage.addEventListener('pointerdown', onPointerDown);
  stage.addEventListener('pointerup', onPointerUp as EventListener);
  stage.addEventListener('click', onClick);
  return () => {
    stage.removeEventListener('pointerdown', onPointerDown);
    stage.removeEventListener('pointerup', onPointerUp as EventListener);
    stage.removeEventListener('click', onClick);
  };
}
