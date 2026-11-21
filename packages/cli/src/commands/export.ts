import { Command } from 'commander';

export const exportCommand = new Command('export')
  .description('Render a film to video')
  .action(() => {
    throw new Error('export: not implemented yet');
  });
