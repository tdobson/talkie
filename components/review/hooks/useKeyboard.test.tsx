import type { Screen } from '@/lib/review/machine';
import { fireEvent, render, screen } from '@/test/helpers/render';
import { useKeyboard } from './useKeyboard';

const FRAME = 1 / 25;

function Harness(props: {
  screen: Screen;
  paused: boolean;
  onToggle: () => void;
  onStep: (delta: number) => void;
}) {
  useKeyboard({ ...props, frameDuration: FRAME });
  return (
    <div>
      <input data-testid="input" />
      <button type="button" data-testid="button">
        Button
      </button>
    </div>
  );
}

function setup(screenName: Screen, paused: boolean) {
  const onToggle = vi.fn();
  const onStep = vi.fn();
  render(<Harness screen={screenName} paused={paused} onToggle={onToggle} onStep={onStep} />);
  return { onToggle, onStep };
}

/** fireEvent returns false when the handler called preventDefault. */
const prevented = (delivered: boolean) => !delivered;

describe('useKeyboard', () => {
  it('space toggles, arrows step one frame only while paused, input focus is ignored', () => {
    const { onToggle, onStep } = setup('player', true);

    expect(prevented(fireEvent.keyDown(document.body, { key: ' ', code: 'Space' }))).toBe(true);
    expect(onToggle).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(onStep).toHaveBeenLastCalledWith(-FRAME);
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(onStep).toHaveBeenLastCalledWith(FRAME);
    fireEvent.keyDown(document.body, { key: 'ArrowLeft', shiftKey: true });
    expect(onStep).toHaveBeenLastCalledWith(-1);
    fireEvent.keyDown(document.body, { key: 'ArrowRight', shiftKey: true });
    expect(onStep).toHaveBeenLastCalledWith(1);
    expect(onStep).toHaveBeenCalledTimes(4);

    const input = screen.getByTestId('input');
    expect(prevented(fireEvent.keyDown(input, { key: ' ', code: 'Space' }))).toBe(false);
    expect(prevented(fireEvent.keyDown(input, { key: 'ArrowLeft' }))).toBe(false);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onStep).toHaveBeenCalledTimes(4);
  });

  it('arrows do nothing during playback, and never reach the scroll bar', () => {
    const { onToggle, onStep } = setup('player', false);
    const reached = vi.fn();
    const button = screen.getByTestId('button');
    button.addEventListener('keydown', reached);
    expect(prevented(fireEvent.keyDown(button, { key: 'ArrowRight' }))).toBe(true);
    expect(onStep).not.toHaveBeenCalled();
    expect(reached).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: ' ', code: 'Space' });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('space on a focused button toggles once and does not also press the button', () => {
    const { onToggle } = setup('player', true);
    const button = screen.getByTestId('button');
    expect(prevented(fireEvent.keyDown(button, { key: ' ', code: 'Space' }))).toBe(true);
    expect(prevented(fireEvent.keyUp(button, { key: ' ', code: 'Space' }))).toBe(true);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('a held space bar toggles once', () => {
    const { onToggle } = setup('player', true);
    fireEvent.keyDown(document.body, { key: ' ', code: 'Space' });
    fireEvent.keyDown(document.body, { key: ' ', code: 'Space', repeat: true });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('space does nothing during a general comment, and the page does not scroll', () => {
    const { onToggle, onStep } = setup('general', true);
    expect(prevented(fireEvent.keyDown(document.body, { key: ' ', code: 'Space' }))).toBe(true);
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(onToggle).not.toHaveBeenCalled();
    expect(onStep).not.toHaveBeenCalled();
  });

  it('is off away from the player', () => {
    const { onToggle } = setup('welcome', true);
    expect(prevented(fireEvent.keyDown(document.body, { key: ' ', code: 'Space' }))).toBe(false);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('works on the end screen so the reviewer can step back', () => {
    const { onStep } = setup('end', true);
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(onStep).toHaveBeenCalledWith(-FRAME);
  });

  it('leaves modified keys alone', () => {
    const { onToggle, onStep } = setup('player', true);
    expect(prevented(fireEvent.keyDown(document.body, { key: 'ArrowLeft', altKey: true }))).toBe(
      false
    );
    fireEvent.keyDown(document.body, { key: ' ', code: 'Space', ctrlKey: true });
    expect(onToggle).not.toHaveBeenCalled();
    expect(onStep).not.toHaveBeenCalled();
  });
});
