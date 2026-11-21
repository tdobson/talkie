import { copy } from '@/lib/review/copy';
import { T } from '@/lib/testids';
import { render, screen, userEvent } from '@/test/helpers/render';
import { EndScreen } from './EndScreen';

describe('EndScreen', () => {
  it('offers a general comment, a second look and Done', async () => {
    const onShareMore = vi.fn();
    const onDone = vi.fn();
    render(<EndScreen onShareMore={onShareMore} onDone={onDone} />);
    const end = screen.getByTestId(T.endScreen);
    expect(end).toHaveTextContent(copy.end.title);
    expect(end).toHaveTextContent(copy.end.otherThings);
    expect(end).toHaveTextContent(copy.end.lookAgain);
    expect(screen.getByTestId(T.shareMore)).toHaveTextContent(copy.end.shareMore);
    await userEvent.click(screen.getByTestId(T.shareMore));
    expect(onShareMore).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByTestId(T.doneButton));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('shows Done as busy while the last comment is being saved', () => {
    render(<EndScreen onShareMore={vi.fn()} onDone={vi.fn()} finishing />);
    expect(screen.getByTestId(T.doneButton)).toBeDisabled();
    expect(screen.getByTestId(T.shareMore)).toBeDisabled();
  });
});
