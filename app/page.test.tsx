import { render, screen } from '@/test/helpers/render';
import HomePage from './page';

test('home page tells visitors to use their review link', () => {
  render(<HomePage />);
  expect(screen.getByText(/review link/i)).toBeInTheDocument();
});
