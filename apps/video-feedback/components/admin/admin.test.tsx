import { T } from '@/lib/testids';
import { render, screen, userEvent, waitFor } from '@/test/helpers/render';
import { CopyLinkButton } from './CopyLinkButton';
import { DownloadButton } from './DownloadButton';
import { inboxFile, sessionRow, summary, versionSummary } from './fixtures';
import { ImportModal } from './ImportModal';
import { InboxTable } from './InboxTable';
import { ReprocessButton } from './ReprocessButton';
import { SessionTable } from './SessionTable';
import { VersionCard } from './VersionCard';
import { VideoTable } from './VideoTable';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

beforeEach(() => refresh.mockClear());

describe('VideoTable', () => {
  it('lists videos with their review link and counts', () => {
    render(<VideoTable videos={[summary]} inboxPath="/srv/data/inbox" />);
    const row = screen.getByTestId(T.adminVideoRow);
    expect(row).toHaveTextContent('Launch film');
    expect(row).toHaveTextContent('3 comments');
    expect(row).toHaveTextContent('2 sessions');
    expect(row).toHaveTextContent('v2');
    expect(row).toHaveTextContent('https://feedback.example.com/r/tok123');
    expect(screen.getByRole('link', { name: 'Launch film' })).toHaveAttribute(
      'href',
      '/admin/videos/launch-film'
    );
    expect(screen.getByTestId(T.adminCopyLink)).toBeInTheDocument();
  });

  it('uses the singular for one comment and shows pending work', () => {
    const one = {
      ...summary,
      versions: [{ ...versionSummary, sessions: 1, comments: 1, pendingProcessing: 2 }],
    };
    render(<VideoTable videos={[one]} inboxPath="/srv/data/inbox" />);
    const row = screen.getByTestId(T.adminVideoRow);
    expect(row).toHaveTextContent('1 comment');
    expect(row).not.toHaveTextContent('1 comments');
    expect(row).toHaveTextContent('1 session');
    expect(row).toHaveTextContent('2 processing');
  });

  it('shows the empty state when there are no videos', () => {
    render(<VideoTable videos={[]} inboxPath="/srv/data/inbox" />);
    expect(screen.queryByTestId(T.adminVideoRow)).not.toBeInTheDocument();
    expect(
      screen.getByText('Drop an MP4 into the inbox folder on the server, then import it here.')
    ).toBeInTheDocument();
    expect(screen.getByText('/srv/data/inbox')).toBeInTheDocument();
  });
});

describe('CopyLinkButton', () => {
  it('copies the review link and says so', async () => {
    const user = userEvent.setup();
    render(<CopyLinkButton url="https://feedback.example.com/r/tok123" />);
    const button = screen.getByTestId(T.adminCopyLink);
    expect(button).toHaveTextContent('Copy link');
    await user.click(button);
    await waitFor(() => expect(button).toHaveTextContent('Copied'));
    expect(await navigator.clipboard.readText()).toBe('https://feedback.example.com/r/tok123');
  });
});

describe('ImportModal', () => {
  it('import modal validates title and shows the server reason on failure', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { ok: false, reason: 'Video must be H.264 (this file is mpeg4)' },
          { status: 400 }
        )
      );
    render(
      <ImportModal file={inboxFile} videos={[]} fetchImpl={fetchImpl} opened onClose={vi.fn()} />
    );
    await userEvent.type(screen.getByTestId(T.adminImportTitle), 'Launch');
    await userEvent.click(screen.getByTestId(T.adminImportSubmit));
    expect(await screen.findByTestId(T.adminImportError)).toHaveTextContent('H.264');
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/admin/inbox',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ filename: 'launch-v3.mp4', mode: 'new', title: 'Launch' }),
      })
    );
  });

  it('refuses an empty title without calling the server', async () => {
    const fetchImpl = vi.fn();
    render(
      <ImportModal file={inboxFile} videos={[]} fetchImpl={fetchImpl} opened onClose={vi.fn()} />
    );
    await userEvent.type(screen.getByTestId(T.adminImportTitle), '   ');
    await userEvent.click(screen.getByTestId(T.adminImportSubmit));
    expect(await screen.findByTestId(T.adminImportError)).toHaveTextContent(
      'Give the video a title'
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('imports as a new version of the chosen video, then closes and refreshes', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(Response.json({ ok: true, videoId: 'launch-film', version: 3 }));
    const onClose = vi.fn();
    render(
      <ImportModal
        file={inboxFile}
        videos={[summary]}
        mode="version"
        fetchImpl={fetchImpl}
        opened
        onClose={onClose}
      />
    );
    expect(screen.queryByTestId(T.adminImportTitle)).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId(T.adminImportSubmit));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fetchImpl.mock.calls[0][1].body).toBe(
      JSON.stringify({ filename: 'launch-v3.mp4', mode: 'version', videoId: 'launch-film' })
    );
    expect(refresh).toHaveBeenCalled();
  });

  it('shows a plain message when the server cannot be reached', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    render(
      <ImportModal file={inboxFile} videos={[]} fetchImpl={fetchImpl} opened onClose={vi.fn()} />
    );
    await userEvent.type(screen.getByTestId(T.adminImportTitle), 'Launch');
    await userEvent.click(screen.getByTestId(T.adminImportSubmit));
    expect(await screen.findByTestId(T.adminImportError)).toHaveTextContent(
      'Could not reach the server'
    );
  });
});

describe('InboxTable', () => {
  it('lists inbox files and opens the import modal for a new video', async () => {
    render(<InboxTable files={[inboxFile]} videos={[summary]} inboxPath="/srv/data/inbox" />);
    const row = screen.getByTestId(T.adminInboxRow);
    expect(row).toHaveTextContent('launch-v3.mp4');
    expect(row).toHaveTextContent('12.5 MB');
    await userEvent.click(screen.getByTestId(T.adminImportNew));
    expect(await screen.findByTestId(T.adminImportTitle)).toBeInTheDocument();
  });

  it('cannot import a new version when there are no videos yet', () => {
    render(<InboxTable files={[inboxFile]} videos={[]} inboxPath="/srv/data/inbox" />);
    expect(screen.getByTestId(T.adminImportVersion)).toBeDisabled();
  });

  it('shows the empty inbox state with the folder path', () => {
    render(<InboxTable files={[]} videos={[]} inboxPath="/srv/data/inbox" />);
    expect(screen.queryByTestId(T.adminInboxRow)).not.toBeInTheDocument();
    expect(screen.getByText('The inbox is empty.')).toBeInTheDocument();
    expect(screen.getByText('/srv/data/inbox')).toBeInTheDocument();
  });
});

describe('DownloadButton', () => {
  const zipUrl = '/api/admin/videos/launch-film/export.zip';

  it('download builds the right URL from version and clips toggle', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const navigate = vi.fn();
    render(
      <DownloadButton videoId="launch-film" version={2} fetchImpl={fetchImpl} navigate={navigate} />
    );
    const link = screen.getByTestId(T.adminDownload);
    expect(link).toHaveAttribute('href', `${zipUrl}?version=2&clips=0`);

    await userEvent.click(screen.getByTestId(T.adminClipsToggle));
    expect(link).toHaveAttribute('href', `${zipUrl}?version=2&clips=1`);

    await userEvent.click(link);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(`${zipUrl}?version=2&clips=1`));
    expect(fetchImpl).toHaveBeenCalledWith(
      `${zipUrl}?version=2&clips=1&partial=0`,
      expect.objectContaining({ method: 'HEAD' })
    );
  });

  it('says how many comments are still processing on a 202 and does not navigate', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    const navigate = vi.fn();
    render(
      <DownloadButton
        videoId="launch-film"
        version={2}
        pending={2}
        fetchImpl={fetchImpl}
        navigate={navigate}
      />
    );
    await userEvent.click(screen.getByTestId(T.adminDownload));
    expect(
      await screen.findByText('Still processing 2 comments, try again in a moment')
    ).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('falls back to a count-free message when the pending count is unknown', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    render(
      <DownloadButton videoId="launch-film" version={2} fetchImpl={fetchImpl} navigate={vi.fn()} />
    );
    await userEvent.click(screen.getByTestId(T.adminDownload));
    expect(
      await screen.findByText('Still processing comments, try again in a moment')
    ).toBeInTheDocument();
  });

  it('reports a failed check instead of navigating', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    const navigate = vi.fn();
    render(
      <DownloadButton videoId="launch-film" version={2} fetchImpl={fetchImpl} navigate={navigate} />
    );
    await userEvent.click(screen.getByTestId(T.adminDownload));
    expect(await screen.findByText(/Could not prepare the download/)).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('ReprocessButton', () => {
  it('posts the version and reports how many comments were queued', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ ok: true, queued: 1 }));
    render(<ReprocessButton videoId="launch-film" version={2} failed={1} fetchImpl={fetchImpl} />);
    await userEvent.click(screen.getByTestId(T.adminReprocess));
    expect(await screen.findByText('Queued 1 comment for another go.')).toBeInTheDocument();
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/admin/videos/launch-film/reprocess',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ version: 2 }) })
    );
    expect(refresh).toHaveBeenCalled();
  });

  it('is disabled when nothing has failed', () => {
    render(<ReprocessButton videoId="launch-film" version={2} failed={0} fetchImpl={vi.fn()} />);
    expect(screen.getByTestId(T.adminReprocess)).toBeDisabled();
  });

  it('reports a failure', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    render(<ReprocessButton videoId="launch-film" version={2} failed={1} fetchImpl={fetchImpl} />);
    await userEvent.click(screen.getByTestId(T.adminReprocess));
    expect(await screen.findByText(/Could not reprocess/)).toBeInTheDocument();
  });
});

describe('SessionTable and VersionCard', () => {
  it('lists sessions with reviewer, comment counts and done state', () => {
    render(
      <SessionTable sessions={[sessionRow, { ...sessionRow, sessionId: 'x', doneAt: null }]} />
    );
    const rows = screen.getAllByTestId(T.adminSessionRow);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Sarah');
    expect(rows[0]).toHaveTextContent('3 comments');
    expect(rows[0]).toHaveTextContent('1 empty');
    expect(rows[0]).toHaveTextContent('1 failed');
    expect(rows[1]).toHaveTextContent('Not finished');
  });

  it('shows the no-sessions state', () => {
    render(<SessionTable sessions={[]} />);
    expect(
      screen.getByText('Nobody has reviewed this version yet. Send them the link above.')
    ).toBeInTheDocument();
  });

  it('version card shows the version, its sessions, download and reprocess', () => {
    render(
      <VersionCard videoId="launch-film" summary={versionSummary} sessions={[sessionRow]} latest />
    );
    expect(screen.getByRole('heading', { name: /Version 2/ })).toBeInTheDocument();
    expect(screen.getByText('Latest')).toBeInTheDocument();
    expect(screen.getByTestId(T.adminSessionRow)).toBeInTheDocument();
    expect(screen.getByTestId(T.adminDownload)).toHaveAttribute(
      'href',
      '/api/admin/videos/launch-film/export.zip?version=2&clips=0'
    );
    expect(screen.getByTestId(T.adminReprocess)).toBeEnabled();
  });
});
