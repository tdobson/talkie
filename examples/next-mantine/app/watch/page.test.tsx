import { readFile } from 'node:fs/promises';
import { render, screen } from '@/test-utils';
import WatchPage from './page';

jest.mock('node:fs/promises', () => ({ readFile: jest.fn() }));
// The real player loads a WebAssembly drawing engine, which jsdom cannot run.
jest.mock('@talkie/player', () => ({ defineTalkiePlayer: jest.fn() }));

const film = {
  talkie: 1,
  title: 'How a batten gauge works',
  duration: 51.794,
  chapters: [
    { title: 'What the gauge is', start: 0 },
    { title: 'Setting it out', start: 75.4 },
  ],
};

describe('Watch page', () => {
  it('renders the film title, the player and the chapter list', async () => {
    jest.mocked(readFile).mockResolvedValue(JSON.stringify(film));
    const { container } = render(await WatchPage());

    expect(screen.getByRole('heading', { name: 'How a batten gauge works' })).toBeInTheDocument();
    const player = container.querySelector('talkie-player');
    expect(player).toHaveAttribute('src', '/films/sample/');
    expect(player).toHaveAttribute('wasm-url', '/dotlottie-player.wasm');
    expect(screen.getByText('What the gauge is')).toBeInTheDocument();
    expect(screen.getByText('Setting it out')).toBeInTheDocument();
    expect(screen.getByText('1:15')).toBeInTheDocument();
  });

  it('says how to build the film when it is not there yet', async () => {
    jest.mocked(readFile).mockRejectedValue(new Error('ENOENT'));
    render(await WatchPage());

    expect(screen.getByText(/yarn sample/)).toBeInTheDocument();
  });
});
