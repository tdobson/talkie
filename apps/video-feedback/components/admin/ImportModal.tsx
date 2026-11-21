'use client';

import { Alert, Button, Group, Modal, NativeSelect, Stack, Text, TextInput } from '@mantine/core';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { T } from '@/lib/testids';
import type { AdminVideoSummary, ImportRequest, ImportResult, InboxFile } from '@/lib/types';

export interface ImportModalProps {
  file: InboxFile;
  videos: AdminVideoSummary[];
  /** `new` asks for a title, `version` asks which video this file is a new version of. */
  mode?: ImportRequest['mode'];
  opened: boolean;
  onClose: () => void;
  fetchImpl?: typeof fetch;
}

/** Imports one inbox file, as a new video or as a new version of an existing one. */
export function ImportModal({
  file,
  videos,
  mode = 'new',
  opened,
  onClose,
  fetchImpl,
}: ImportModalProps) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [videoId, setVideoId] = useState(videos[0]?.videoId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function buildRequest(): ImportRequest | string {
    if (mode === 'version') {
      if (!videoId) return 'Choose which video this is a new version of.';
      return { filename: file.filename, mode: 'version', videoId };
    }
    const trimmed = title.trim();
    if (!trimmed) return 'Give the video a title.';
    return { filename: file.filename, mode: 'new', title: trimmed };
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const request = buildRequest();
    if (typeof request === 'string') {
      setError(request);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await (fetchImpl ?? fetch)('/api/admin/inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const result = (await res.json().catch(() => null)) as ImportResult | null;
      if (result?.ok) {
        setTitle('');
        onClose();
        router.refresh();
      } else {
        setError(result?.reason ?? `The import failed (error ${res.status}).`);
      }
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={mode === 'new' ? 'Import as a new video' : 'Import as a new version'}
      closeOnClickOutside={!busy}
    >
      <form onSubmit={onSubmit} noValidate>
        <Stack>
          <Text size="sm" c="dimmed">
            File: {file.filename}
          </Text>
          {mode === 'new' ? (
            <TextInput
              label="Title"
              description="Reviewers see this at the top of the page."
              placeholder="e.g. Launch film"
              value={title}
              onChange={(event) => setTitle(event.currentTarget.value)}
              data-autofocus
              data-testid={T.adminImportTitle}
            />
          ) : (
            <NativeSelect
              label="New version of"
              description="The review link stays the same and reviewers get the new version."
              value={videoId}
              onChange={(event) => setVideoId(event.currentTarget.value)}
              data={videos.map((v) => ({
                value: v.videoId,
                label: `${v.title} (currently v${v.latestVersion})`,
              }))}
            />
          )}
          {error && (
            <Alert color="red" role="alert" data-testid={T.adminImportError}>
              {error}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} data-testid={T.adminImportSubmit}>
              Import
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
