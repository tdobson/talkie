import { copy } from '@/lib/review/copy';
import { T } from '@/lib/testids';
import { render, screen, userEvent } from '@/test/helpers/render';
import { MobileBlock } from './MobileBlock';

describe('MobileBlock', () => {
  it('asks for a computer and copies the link', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    render(<MobileBlock />);
    expect(screen.getByTestId(T.mobileBlock)).toHaveTextContent(copy.mobile.title);
    expect(screen.getByTestId(T.mobileBlock)).toHaveTextContent(copy.mobile.body);
    const button = screen.getByTestId(T.mobileCopyLink);
    expect(button).toHaveTextContent(copy.mobile.copy);
    await user.click(button);
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(await screen.findByText(copy.mobile.copied)).toBeInTheDocument();
  });
});
