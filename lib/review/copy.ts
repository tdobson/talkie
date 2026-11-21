export const copy = {
  pageTitle: (title: string) => `Feedback: ${title}`,
  welcome: {
    thanks: 'Thanks for taking a look.',
    para1:
      "Any time you see something that's not right, just pause it and explain it to me as if I'm sat right next to you.",
    para2:
      "Point at things with your mouse. I can't see your finger, but I can see the pointer. The more specific you are about which bit you'd change, the better.",
    nameLabel: 'Your name',
    namePlaceholder: 'e.g. Sarah',
    start: 'Start',
  },
  micExplain: {
    title: 'We need your microphone',
    body: 'Your browser is about to ask if this page can use your microphone. Please click Allow: it only records while the video is paused.',
    continue: 'Continue',
  },
  micCheck: {
    title: 'Say hello so we know we can hear you',
    heard: 'Got you, loud and clear',
    startWatching: 'Start watching',
  },
  micDenied: {
    title: "We can't hear you yet",
    body: 'Your browser blocked the microphone. To fix it:',
    chrome:
      'Chrome or Edge: click the icon to the left of the web address, set Microphone to Allow, then reload.',
    firefox:
      'Firefox: click the microphone icon in the address bar, remove the block, then reload.',
    safari:
      'Safari: open Safari > Settings for This Website, set Microphone to Allow, then reload.',
    retry: 'Try again',
  },
  player: {
    hint: 'Spotted something? Pause and tell me.',
    done: "I'm done",
    listening: 'Listening',
    listeningHelp: "Point and explain. Press play when you're done.",
    listeningTips: 'Hold the mouse down to zoom in. Use ← → to step through frames.',
    saving: 'Saving...',
    saved: 'Saved',
    trouble: "Having trouble saving. Keep this tab open and we'll keep trying.",
    micLost: "We've lost your microphone",
    micReconnect: 'Reconnect',
  },
  end: {
    title: "That's the end of the video.",
    otherThings: "Got any other things to mention that you haven't mentioned anywhere else?",
    shareMore: 'Click here to share them now',
    lookAgain: 'Want to look at something again? Scroll back and pause on it.',
    done: "I'm done",
  },
  general: {
    listening: 'Listening',
    prompt1: 'Was there anything missing?',
    prompt2: "Anything else you'd change, keep, or want to see?",
    finished: 'Finished, save that',
  },
  thanks: {
    title: (name: string) => `Thanks, ${name}.`,
    body: "That's all come through. If you think of anything else, open the same link again and carry on.",
  },
  mobile: {
    title: 'Best on a computer',
    body: 'This review works by pointing with a mouse while you talk, so please open this link on a laptop or desktop.',
    copy: 'Copy link',
    copied: 'Copied',
  },
  invalid: {
    title: "This link isn't valid",
    body: 'Check you have the whole link, or ask whoever sent it for a new one.',
  },
} as const;
