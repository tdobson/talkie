import { defineConfig } from '@talkie/cli';

// "How a batten gauge works": a made-up job on a made-up street, with made-up sizes.
export default defineConfig({
  title: 'How a batten gauge works',
  size: [1280, 720],
  chapters: [
    { title: 'What the gauge is', scenes: ['roof', 'gauge'] },
    { title: 'Setting it out', scenes: ['setting-out'] },
  ],
  // The fake voice needs no key and no network, so the sample builds anywhere.
  voice: {
    provider: 'fake',
    voice: 'sample',
    prompt: 'Read this narration in a calm, clear voice, at an even pace.',
    lexicon: { headlap: 'head lap' },
  },
  // The film says 300 mm. A label with this other figure would stop the build.
  conflicts: ['345 mm'],
});
