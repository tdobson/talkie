import { copy } from '@/lib/review/copy';
import { T } from '@/lib/testids';
import { render, screen, userEvent } from '@/test/helpers/render';
import { MicExplain } from './MicExplain';

describe('MicExplain', () => {
  it('explains the permission prompt before it appears', async () => {
    const onContinue = vi.fn();
    render(<MicExplain onContinue={onContinue} />);
    expect(screen.getByTestId(T.micExplain)).toHaveTextContent(copy.micExplain.title);
    expect(screen.getByTestId(T.micExplain)).toHaveTextContent(copy.micExplain.body);
    await userEvent.click(screen.getByTestId(T.micContinue));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('cannot be pressed twice while the browser is asking', () => {
    render(<MicExplain onContinue={vi.fn()} waiting />);
    expect(screen.getByTestId(T.micContinue)).toBeDisabled();
  });
});
