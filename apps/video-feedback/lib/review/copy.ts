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
    /** A browser that has reviewed before: no name to type. */
    welcomeBack: (name: string) => `Welcome back, ${name}.`,
    notYou: (name: string) => `Not ${name}?`,
  },
  /** Shown once a video has more than one version, so a reviewer knows which cut this is. */
  version: (n: number) => `Version ${n}`,
  newerVersion: (latest: number, previous: number) =>
    `There's a new version of this film since you last looked. You're now reviewing version ${latest}. Your comments on version ${previous} are kept.`,
  micExplain: {
    title: 'We need your microphone',
    body: 'Your browser is about to ask if this page can use your microphone. Please click Allow: it only records while the video is paused.',
    continue: 'Continue',
  },
  micCheck: {
    title: 'Say hello so we know we can hear you',
    heard: 'Got you, loud and clear.',
    starting: 'Starting the video',
    tryAgain: 'Try again',
    skip: 'Carry on anyway',
    startFailed: "We couldn't get started. Check your connection and try again.",
    quietHelp:
      "Can't see the meter move? Check the right microphone is selected and not muted, then speak up.",
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
    noDevice: "We couldn't find a microphone. Plug one in or switch it on, then try again.",
  },
  player: {
    hint: 'Spotted something? Pause and tell me.',
    giveFeedback: 'Give feedback',
    idleHint: 'Got something to say? Pause any time.',
    done: "I'm done",
    listening: 'Listening',
    listeningHelp: "Point and explain. Press play when you're done.",
    listeningTips: 'Hold the mouse down to zoom in. Use ← → to step through frames.',
    saving: 'Saving...',
    saved: 'Saved',
    trouble: "Having trouble saving. Keep this tab open and we'll keep trying.",
    micLost: "We've lost your microphone",
    micReconnect: 'Reconnect',
    videoError: "We couldn't load the video. Check your connection and reload.",
    reload: 'Reload',
    loading: 'Loading the video',
    limitWarning: "Less than a minute left on this comment. Press play when you're done.",
    heldSilenceTitle: 'Paused, not recording',
    heldSilenceHelp:
      "We stopped recording after a quiet spell, and saved what you said. Talk to add more, or press play when you're ready.",
    heldCapTitle: 'Saved, not recording',
    heldCapHelp:
      'That comment reached the longest one can be, and it is saved. Press play to watch on, or Say more to add another here.',
    heldFocusTitle: 'Stopped: this tab lost focus',
    heldFocusHelp: 'Come back to this tab to carry on talking, or press play.',
    sayMore: 'Say more',
    stopped: 'This comment is full, so we have stopped recording it.',
    stoppedHelp: 'Press play, then pause again to carry on.',
    fullscreen: 'Full screen',
    exitFullscreen: 'Exit full screen',
    micStillLost:
      "Still can't reach a microphone. Check it's plugged in and allowed, then try again.",
    captionsOn: 'Captions on',
    captionsOff: 'Captions off',
    back: (seconds: number) => `Back ${seconds} seconds`,
    forward: (seconds: number) => `Forward ${seconds} seconds`,
  },
  practice: {
    banner: 'Practice run: nothing you say here is saved.',
    introTitle: 'First, a quick practice',
    intro1:
      'When you want to say something about the film, pause it and talk. Point at the picture with your mouse as you go.',
    intro2:
      "Let's try it once. Press Start practice, then pause whenever you like and say anything. Nothing in the practice is saved, and after it the film starts again from the beginning for real.",
    start: 'Start practice',
    coachKeys: 'Now press pause, or the space bar.',
    coachTouch: 'Now tap pause.',
    coachPlay: 'Press play to start the practice.',
    listening: 'Listening',
    listeningHelp: 'Now say something, anything. This one is just practice.',
    gotThat: 'Got that',
    gotThatHelp: "That's all there is to it. Now for real: starting from the beginning.",
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
    stopped: 'This comment is full, so we have stopped recording it.',
    stoppedHelp: 'Press "Finished, save that" to keep what you said.',
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
  admin: {
    filmInvalid: 'This film did not pass validation: {errors}',
    filmVersion: 'This film needs Talkie version {major}, which this tool does not read yet.',
    chromiumMissing: 'Chromium is not installed for Talkie stills; see DEPLOY.md',
  },
} as const;
