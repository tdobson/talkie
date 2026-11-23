import type { PipelineStatus } from '@/lib/pipeline/pipeline-status';
import { pipelineLine } from './pipeline-line';

const now = Date.parse('2026-11-24T10:00:00Z');
const idle: PipelineStatus = {
  pid: 1,
  updatedAt: '2026-11-24T09:59:58Z',
  comments: { running: null, waiting: 0 },
  clips: { running: null, waiting: 0 },
};
const job = { videoId: 'v', sessionId: 's', commentId: 'c' };

it('says when everything is done', () => {
  expect(pipelineLine(idle, now)).toEqual({
    text: 'Comment processing is idle: everything is done.',
    tone: 'ok',
  });
});

it('says what it is working on and what waits', () => {
  const busy: PipelineStatus = {
    ...idle,
    comments: { running: { ...job, since: '2026-11-24T09:58:00Z' }, waiting: 15 },
    clips: { running: { ...job, since: '2026-11-24T09:15:00Z' }, waiting: 1 },
  };
  expect(pipelineLine(busy, now)).toEqual({
    text: 'Comment processing: processing a comment (for 2 minutes), 15 comments waiting, rendering a clip (for 45 minutes), 1 clip waiting.',
    tone: 'busy',
  });
});

it('says when the worker is not running', () => {
  expect(pipelineLine(null, now).tone).toBe('down');
  expect(pipelineLine({ ...idle, updatedAt: '2026-11-24T09:50:00Z' }, now)).toEqual({
    text: 'Comment processing is not running (last seen 10 minutes ago).',
    tone: 'down',
  });
});
