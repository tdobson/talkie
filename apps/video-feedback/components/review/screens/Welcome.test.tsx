import { T } from '@/lib/testids';
import { render, screen, userEvent } from '@/test/helpers/render';
import { Welcome } from './Welcome';

describe('Welcome', () => {
  it('shows the instructions and disables Start until a name is typed', async () => {
    render(<Welcome title="Launch film" onSubmit={vi.fn()} />);
    expect(screen.getByText(/as if I'm sat right next to you/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Feedback: Launch film' })).toBeInTheDocument();
    expect(screen.getByTestId(T.startButton)).toBeDisabled();
    await userEvent.type(screen.getByTestId(T.nameInput), 'Sarah');
    expect(screen.getByTestId(T.startButton)).toBeEnabled();
  });

  it('keeps Start disabled for a name of only spaces', async () => {
    render(<Welcome title="Launch film" onSubmit={vi.fn()} />);
    await userEvent.type(screen.getByTestId(T.nameInput), '   ');
    expect(screen.getByTestId(T.startButton)).toBeDisabled();
  });

  it('submits the trimmed name on Start and on Enter', async () => {
    const onSubmit = vi.fn();
    render(<Welcome title="Launch film" onSubmit={onSubmit} />);
    await userEvent.type(screen.getByTestId(T.nameInput), ' Sarah ');
    await userEvent.click(screen.getByTestId(T.startButton));
    expect(onSubmit).toHaveBeenLastCalledWith('Sarah');
    await userEvent.type(screen.getByTestId(T.nameInput), '{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it('shows the film poster when there is one', () => {
    const src = '/api/r/tok/film/2/poster.png';
    const { container } = render(
      <Welcome title="Launch film" posterUrl={src} onSubmit={vi.fn()} />
    );
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', src);
    // Decorative: the heading already names the film.
    expect(img).toHaveAttribute('alt', '');
  });

  it('shows no picture when there is no poster', () => {
    const { container } = render(<Welcome title="Launch film" onSubmit={vi.fn()} />);
    expect(container.querySelector('img')).toBeNull();
  });

  it('moves focus to the heading for screen readers', () => {
    render(<Welcome title="Launch film" onSubmit={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Feedback: Launch film' })).toHaveFocus();
  });
});
