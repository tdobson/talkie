import { copy } from '@/lib/review/copy';
import { T } from '@/lib/testids';
import { render, screen, userEvent } from '@/test/helpers/render';
import { GeneralComment } from './GeneralComment';

const stream = {} as MediaStream;

describe('GeneralComment', () => {
  it('shows it is listening, both prompts and the Finished button', async () => {
    const onFinished = vi.fn();
    render(
      <GeneralComment
        stream={stream}
        micLost={false}
        onReconnect={vi.fn()}
        onFinished={onFinished}
      />
    );
    const general = screen.getByTestId(T.generalComment);
    expect(general).toHaveTextContent(copy.general.listening);
    expect(general).toHaveTextContent(copy.general.prompt1);
    expect(general).toHaveTextContent(copy.general.prompt2);
    expect(screen.getByTestId(T.listeningLevel)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    await userEvent.click(screen.getByTestId(T.generalFinished));
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('offers to reconnect a lost microphone', async () => {
    const onReconnect = vi.fn();
    render(
      <GeneralComment stream={stream} micLost onReconnect={onReconnect} onFinished={vi.fn()} />
    );
    expect(screen.getByTestId(T.micLost)).toHaveTextContent(copy.player.micLost);
    await userEvent.click(screen.getByTestId(T.micReconnect));
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });
});
