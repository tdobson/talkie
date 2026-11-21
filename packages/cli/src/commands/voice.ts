import { Command } from 'commander';

export const voiceCommand = new Command('voice')
  .description('Generate narration for a film project')
  .action(() => {
    throw new Error('voice: not implemented yet');
  });
