import type { AdminSessionRow } from '@/lib/admin/sessions';
import type { AdminVersionSummary, AdminVideoSummary, InboxFile } from '@/lib/types';

/** Sample data for the admin component tests. */
export const versionSummary: AdminVersionSummary = {
  version: 2,
  sessions: 2,
  comments: 3,
  emptyComments: 1,
  failedComments: 1,
  pendingProcessing: 0,
  lastActivity: '2026-11-20T14:30:00.000Z',
};

export const summary: AdminVideoSummary = {
  videoId: 'launch-film',
  title: 'Launch film',
  reviewUrl: 'https://feedback.example.com/r/tok123',
  latestVersion: 2,
  versions: [
    {
      version: 1,
      sessions: 0,
      comments: 0,
      emptyComments: 0,
      failedComments: 0,
      pendingProcessing: 0,
      lastActivity: null,
    },
    versionSummary,
  ],
};

export const inboxFile: InboxFile = {
  filename: 'launch-v3.mp4',
  sizeBytes: 12_500_000,
  modifiedAt: '2026-11-21T09:00:00.000Z',
};

export const sessionRow: AdminSessionRow = {
  sessionId: '0b0e7c1e-6f0a-4a57-9d43-0f6f8f2f8a11',
  version: 2,
  reviewerName: 'Sarah',
  startedAt: '2026-11-20T14:00:00.000Z',
  doneAt: '2026-11-20T14:30:00.000Z',
  comments: 3,
  emptyComments: 1,
  failedComments: 1,
};
