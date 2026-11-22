import { MIC_HEARD_SHOW_MS, MIC_SPEECH_HOLD_MS } from '@/lib/constants';
import { copy } from '@/lib/review/copy';
import { T } from '@/lib/testids';
import { act, fireEvent, render, screen } from '@/test/helpers/render';
import { MicCheck, QUIET_HELP_AFTER_MS } from './MicCheck';

let level = 0;
vi.mock('../hooks/useMicLevel', () => ({ useMicLevel: () => level }));

const stream = {} as MediaStream;

describe('MicCheck', () => {
  beforeEach(() => {
    level = 0;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('has no button, and starts by itself a moment after hearing speech', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const onHeard = vi.fn();
    const onStart = vi.fn();
    const view = render(<MicCheck stream={stream} onHeard={onHeard} onStart={onStart} />);
    const rerender = () =>
      act(() => view.rerender(<MicCheck stream={stream} onHeard={onHeard} onStart={onStart} />));

    expect(screen.getByTestId(T.micCheck)).toHaveTextContent(copy.micCheck.title);
    expect(screen.getByTestId(T.micMeter)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByTestId(T.micHeard)).toBeNull();

    level = 0.5;
    rerender();
    expect(screen.queryByTestId(T.micHeard)).toBeNull();

    now.mockReturnValue(1000 + MIC_SPEECH_HOLD_MS);
    rerender();
    expect(screen.getByTestId(T.micHeard)).toHaveTextContent(copy.micCheck.heard);
    expect(onHeard).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();

    // Going quiet again changes nothing: it still starts.
    level = 0;
    rerender();
    act(() => {
      vi.advanceTimersByTime(MIC_HEARD_SHOW_MS);
    });
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith(true);
  });

  it('a short noise is not enough', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const onStart = vi.fn();
    const view = render(<MicCheck stream={stream} onHeard={vi.fn()} onStart={onStart} />);
    const rerender = () =>
      act(() => view.rerender(<MicCheck stream={stream} onHeard={vi.fn()} onStart={onStart} />));
    level = 0.5;
    rerender();
    level = 0;
    now.mockReturnValue(100);
    rerender();
    level = 0.5;
    now.mockReturnValue(MIC_SPEECH_HOLD_MS + 50);
    rerender();
    act(() => {
      vi.advanceTimersByTime(MIC_HEARD_SHOW_MS + 100);
    });
    expect(screen.queryByTestId(T.micHeard)).toBeNull();
    expect(onStart).not.toHaveBeenCalled();
  });

  it('shows that it is starting', () => {
    render(<MicCheck stream={stream} onHeard={vi.fn()} onStart={vi.fn()} starting />);
    expect(screen.getByLabelText(copy.micCheck.starting)).toBeInTheDocument();
  });

  it('says so when the session could not be started, and can try again', () => {
    const onStart = vi.fn();
    const view = render(<MicCheck stream={stream} onHeard={() => {}} onStart={onStart} />);
    expect(screen.queryByRole('alert')).toBeNull();
    view.rerender(<MicCheck stream={stream} onHeard={() => {}} onStart={onStart} startFailed />);
    expect(screen.getByRole('alert')).toHaveTextContent(copy.micCheck.startFailed);
    fireEvent.click(screen.getByTestId(T.startWatching));
    expect(onStart).toHaveBeenCalledWith(true);
  });

  it('offers help and a way on when nothing has been heard for a while', () => {
    const onStart = vi.fn();
    render(<MicCheck stream={stream} onHeard={() => {}} onStart={onStart} />);
    expect(screen.queryByTestId(T.micCheckHelp)).toBeNull();
    expect(screen.queryByTestId(T.micSkip)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(QUIET_HELP_AFTER_MS + 200);
    });
    expect(screen.getByTestId(T.micCheckHelp)).toHaveTextContent(copy.micCheck.quietHelp);
    fireEvent.click(screen.getByTestId(T.micSkip));
    // Carrying on without being heard skips the practice: it needs to hear them.
    expect(onStart).toHaveBeenCalledWith(false);
  });
});
