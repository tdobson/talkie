import { copy } from '@/lib/review/copy';
import { T } from '@/lib/testids';
import { render, screen } from '@/test/helpers/render';
import { Thanks } from './Thanks';

describe('Thanks', () => {
  it('thanks the reviewer by name', () => {
    render(<Thanks name="Sarah" />);
    expect(screen.getByTestId(T.thanks)).toHaveTextContent('Thanks, Sarah.');
    expect(screen.getByTestId(T.thanks)).toHaveTextContent(copy.thanks.body);
    expect(screen.getByRole('heading', { name: 'Thanks, Sarah.' })).toHaveFocus();
  });
});
