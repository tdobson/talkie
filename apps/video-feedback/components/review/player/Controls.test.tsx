import { copy } from '@/lib/review/copy';
import { T } from '@/lib/testids';
import { fireEvent, render, screen, userEvent } from '@/test/helpers/render';
import { Controls, SCROLL_STEPS } from './Controls';

function makeHandlers() {
  return {
    volume: 1,
    onPlayPause: vi.fn(),
    onSeek: vi.fn(),
    onVolume: vi.fn(),
    onFullscreen: vi.fn(),
    onDone: vi.fn(),
  };
}

describe('Controls', () => {
  it('never renders a timecode', () => {
    const handlers = makeHandlers();
    render(<Controls currentTime={754.2} duration={900} playing={false} {...handlers} />);
    expect(document.body.textContent).not.toMatch(/\d+:\d{2}/);
    expect(document.body.innerHTML).not.toMatch(/754|12:34/);
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      expect(el.getAttribute('title')).toBeNull();
    }
  });

  it('describes the scroll bar without a time', () => {
    render(<Controls currentTime={754.2} duration={900} playing={false} {...makeHandlers()} />);
    const thumb = screen.getByTestId(T.scrollBar).querySelector('[role="slider"]');
    expect(thumb).toHaveAttribute('aria-valuetext', 'Position in video');
    expect(thumb).toHaveAttribute(
      'aria-valuenow',
      String(Math.round((754.2 / 900) * SCROLL_STEPS))
    );
  });

  it('has play, volume, fullscreen, the hint and Done', async () => {
    const handlers = makeHandlers();
    render(<Controls currentTime={0} duration={900} playing={false} {...handlers} />);
    expect(screen.getByTestId(T.playHint)).toHaveTextContent(copy.player.hint);
    expect(screen.getByTestId(T.volume)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId(T.playPause));
    expect(handlers.onPlayPause).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByTestId(T.fullscreen));
    expect(handlers.onFullscreen).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByTestId(T.doneButton));
    expect(handlers.onDone).toHaveBeenCalledTimes(1);
  });

  it('labels the play button by what it will do', () => {
    const handlers = makeHandlers();
    const view = render(<Controls currentTime={0} duration={900} playing={false} {...handlers} />);
    expect(screen.getByTestId(T.playPause)).toHaveAccessibleName('Play');
    view.rerender(<Controls currentTime={0} duration={900} playing {...handlers} />);
    expect(screen.getByTestId(T.playPause)).toHaveAccessibleName('Pause');
  });

  it('can hide Done while the end screen shows its own', () => {
    render(
      <Controls
        currentTime={0}
        duration={900}
        playing={false}
        showDone={false}
        {...makeHandlers()}
      />
    );
    expect(screen.queryByTestId(T.doneButton)).toBeNull();
  });

  it('turns a scroll bar step into a seek in seconds', () => {
    const handlers = makeHandlers();
    render(<Controls currentTime={450} duration={900} playing={false} {...handlers} />);
    const thumb = screen.getByTestId(T.scrollBar).querySelector('[role="slider"]') as HTMLElement;
    fireEvent.keyDown(thumb, { key: 'ArrowRight' });
    expect(handlers.onSeek).toHaveBeenCalledTimes(1);
    expect(handlers.onSeek.mock.calls[0][0]).toBeCloseTo(450 + 900 / SCROLL_STEPS, 5);
  });

  it('is inert before the video length is known', () => {
    const handlers = makeHandlers();
    render(<Controls currentTime={0} duration={0} playing={false} {...handlers} />);
    const thumb = screen.getByTestId(T.scrollBar).querySelector('[role="slider"]') as HTMLElement;
    fireEvent.keyDown(thumb, { key: 'ArrowRight' });
    expect(handlers.onSeek).not.toHaveBeenCalled();
  });

  it('has no captions toggle unless the media has captions', () => {
    render(<Controls currentTime={0} duration={900} playing={false} {...makeHandlers()} />);
    expect(screen.queryByTestId(T.captionsToggle)).toBeNull();
  });

  it('the captions toggle says whether captions are on, and asks to change it', () => {
    const onCaptions = vi.fn();
    const props = { currentTime: 0, duration: 900, playing: false, ...makeHandlers(), onCaptions };
    const { rerender } = render(<Controls {...props} captions />);
    const toggle = screen.getByTestId(T.captionsToggle);
    expect(toggle).toHaveAccessibleName(copy.player.captionsOn);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(toggle);
    expect(onCaptions).toHaveBeenCalledTimes(1);

    rerender(<Controls {...props} captions={false} />);
    expect(screen.getByTestId(T.captionsToggle)).toHaveAccessibleName(copy.player.captionsOff);
    expect(screen.getByTestId(T.captionsToggle)).toHaveAttribute('aria-pressed', 'false');
    expect(document.body.textContent).not.toMatch(/\d+:\d{2}/);
  });
});
