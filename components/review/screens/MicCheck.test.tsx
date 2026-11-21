import { MIC_SPEECH_HOLD_MS } from '@/lib/constants';
import { copy } from '@/lib/review/copy';
import { T } from '@/lib/testids';
import { act, render, screen, userEvent } from '@/test/helpers/render';
import { MicCheck } from './MicCheck';

let level = 0;
vi.mock('../hooks/useMicLevel', () => ({ useMicLevel: () => level }));

const stream = {} as MediaStream;

describe('MicCheck', () => {
  beforeEach(() => {
    level = 0;
  });
  afterEach(() => vi.restoreAllMocks());

  it('keeps Start watching disabled until speech has been heard for long enough', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const onHeard = vi.fn();
    const onStart = vi.fn();
    const view = render(<MicCheck stream={stream} onHeard={onHeard} onStart={onStart} />);
    const rerender = () =>
      act(() => view.rerender(<MicCheck stream={stream} onHeard={onHeard} onStart={onStart} />));

    expect(screen.getByTestId(T.micCheck)).toHaveTextContent(copy.micCheck.title);
    expect(screen.getByTestId(T.micMeter)).toBeInTheDocument();
    expect(screen.getByTestId(T.startWatching)).toBeDisabled();
    expect(screen.queryByTestId(T.micHeard)).toBeNull();

    level = 0.5;
    rerender();
    expect(screen.getByTestId(T.startWatching)).toBeDisabled();

    now.mockReturnValue(1000 + MIC_SPEECH_HOLD_MS);
    rerender();
    expect(screen.getByTestId(T.micHeard)).toHaveTextContent(copy.micCheck.heard);
    expect(screen.getByTestId(T.startWatching)).toBeEnabled();
    expect(onHeard).toHaveBeenCalledTimes(1);

    // Going quiet again does not lock the button.
    level = 0;
    rerender();
    expect(screen.getByTestId(T.startWatching)).toBeEnabled();

    await userEvent.click(screen.getByTestId(T.startWatching));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('a short noise is not enough', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const view = render(<MicCheck stream={stream} onHeard={vi.fn()} onStart={vi.fn()} />);
    const rerender = () =>
      act(() => view.rerender(<MicCheck stream={stream} onHeard={vi.fn()} onStart={vi.fn()} />));
    level = 0.5;
    rerender();
    level = 0;
    now.mockReturnValue(100);
    rerender();
    level = 0.5;
    now.mockReturnValue(MIC_SPEECH_HOLD_MS + 50);
    rerender();
    expect(screen.getByTestId(T.startWatching)).toBeDisabled();
  });

  it('shows a busy button while the session is starting', () => {
    render(<MicCheck stream={stream} onHeard={vi.fn()} onStart={vi.fn()} starting />);
    expect(screen.getByTestId(T.startWatching)).toBeDisabled();
  });
});
