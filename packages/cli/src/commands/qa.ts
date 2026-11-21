import { Command } from 'commander';

export const qaCommand = new Command('qa')
  .description('Run quality checks on a film project')
  .action(() => {
    throw new Error('qa: not implemented yet');
  });
