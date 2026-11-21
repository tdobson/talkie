import { copy } from '@/lib/review/copy';
import { T } from '@/lib/testids';
import { render, screen, userEvent, within } from '@/test/helpers/render';
import { browserFamily, MicDenied } from './MicDenied';

const UA = {
  chrome:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
  firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:150.0) Gecko/20100101 Firefox/150.0',
  safari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15',
};

describe('browserFamily', () => {
  it('tells the three families apart', () => {
    expect(browserFamily(UA.chrome)).toBe('chrome');
    expect(browserFamily(UA.edge)).toBe('chrome');
    expect(browserFamily(UA.firefox)).toBe('firefox');
    expect(browserFamily(UA.safari)).toBe('safari');
    expect(browserFamily('curl/8')).toBeNull();
  });
});

describe('MicDenied', () => {
  it('puts the steps for this browser first and lists the others as a fallback', async () => {
    const onRetry = vi.fn();
    render(<MicDenied userAgent={UA.firefox} onRetry={onRetry} />);
    const card = screen.getByTestId(T.micDenied);
    expect(card).toHaveTextContent(copy.micDenied.title);
    expect(card).toHaveTextContent(copy.micDenied.body);
    const items = within(card).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      copy.micDenied.firefox,
      copy.micDenied.chrome,
      copy.micDenied.safari,
    ]);
    expect(items[0]).toHaveAttribute('data-current', 'true');
    await userEvent.click(screen.getByTestId(T.micRetry));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('lists all three for an unknown browser', () => {
    render(<MicDenied userAgent="curl/8" onRetry={vi.fn()} />);
    expect(within(screen.getByTestId(T.micDenied)).getAllByRole('listitem')).toHaveLength(3);
  });
});
