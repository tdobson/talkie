// Reviewer copy and test ids added in Phase 6 (Task 6.2). `lib/review/copy.ts` and
// `lib/testids.ts` are frozen shared files, so the additions live here until an integration
// step folds them in. No em-dashes, and nothing here shows a timecode.

export const moreCopy = {
  player: {
    videoError: "We couldn't load the video. Check your connection and reload.",
    reload: 'Reload',
    loading: 'Loading the video',
    stopped: 'This comment is full, so we have stopped recording it.',
    stoppedHelp: 'Press play, then pause again to carry on.',
    fullscreen: 'Full screen',
    exitFullscreen: 'Exit full screen',
    micStillLost:
      "Still can't reach a microphone. Check it's plugged in and allowed, then try again.",
  },
  general: {
    stopped: 'This comment is full, so we have stopped recording it.',
    stoppedHelp: 'Press "Finished, save that" to keep what you said.',
  },
  micCheck: {
    quietHelp:
      "Can't see the meter move? Check the right microphone is selected and not muted, then speak up.",
  },
  micDenied: {
    noDevice: "We couldn't find a microphone. Plug one in or switch it on, then try again.",
  },
} as const;

export const MORE_T = {
  videoError: 'video-error',
  videoReload: 'video-reload',
  videoLoading: 'video-loading',
  commentStopped: 'comment-stopped',
  micStillLost: 'mic-still-lost',
  micCheckHelp: 'mic-check-help',
  micNoDevice: 'mic-no-device',
} as const;
