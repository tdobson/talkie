import { defineConfig } from '@talkie/cli';

export default defineConfig({
  title: 'Mini film',
  size: [320, 180],
  chapters: [
    { title: 'The tile', scenes: ['one'] },
    { title: 'The nail', scenes: ['two'] },
  ],
  voice: { provider: 'fake', voice: 'test', prompt: 'calm', lexicon: { soffit: 'soff it' } },
  conflicts: ['345 mm'],
});
