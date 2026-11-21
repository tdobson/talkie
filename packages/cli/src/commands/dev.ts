import { Command } from 'commander';

export const devCommand = new Command('dev')
  .description('Build, serve and watch a film project')
  .action(() => {
    throw new Error('dev: not implemented yet');
  });
