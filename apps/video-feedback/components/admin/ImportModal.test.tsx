import { T } from '@/lib/testids';
import type { InboxFile } from '@/lib/types';
import { render, screen, userEvent, waitFor } from '@/test/helpers/render';
import { ImportModal } from './ImportModal';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const entry = (filename: string): InboxFile => ({
  filename,
  sizeBytes: 1000,
  modifiedAt: '2026-11-21T09:00:00.000Z',
});

function open(filename: string, fetchImpl = vi.fn()) {
  const onClose = vi.fn();
  render(
    <ImportModal
      file={entry(filename)}
      videos={[]}
      fetchImpl={fetchImpl}
      opened
      onClose={onClose}
    />
  );
  return { fetchImpl, onClose };
}

describe('ImportModal with Talkie films', () => {
  it.each([
    ['launch.mp4', 'Video file: launch.mp4'],
    ['launch.MOV', 'Video file: launch.MOV'],
    ['launch.lottie', 'Talkie film: launch.lottie'],
    ['launch.LOTTIE', 'Talkie film: launch.LOTTIE'],
    ['launch-film', 'Talkie film folder: launch-film'],
  ])('says what kind of thing %s is', (filename, label) => {
    open(filename);
    expect(screen.getByTestId(T.adminImportSubmit)).toBeInTheDocument();
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('imports a .lottie by name, with no kind field: the server decides by what the file is', async () => {
    const { fetchImpl, onClose } = open(
      'launch.lottie',
      vi.fn().mockResolvedValue(Response.json({ ok: true, videoId: 'launch', version: 1 }))
    );
    await userEvent.type(screen.getByTestId(T.adminImportTitle), 'Launch');
    await userEvent.click(screen.getByTestId(T.adminImportSubmit));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fetchImpl.mock.calls[0][1].body).toBe(
      JSON.stringify({ filename: 'launch.lottie', mode: 'new', title: 'Launch' })
    );
  });

  it('shows the film refusal the server gives', async () => {
    const reason = 'This film needs Talkie version 2, which this tool does not read yet.';
    open(
      'launch.lottie',
      vi.fn().mockResolvedValue(Response.json({ ok: false, reason }, { status: 400 }))
    );
    await userEvent.type(screen.getByTestId(T.adminImportTitle), 'Launch');
    await userEvent.click(screen.getByTestId(T.adminImportSubmit));
    expect(await screen.findByTestId(T.adminImportError)).toHaveTextContent(reason);
  });
});
