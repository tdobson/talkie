import { Command } from 'commander';

export const checkCommand = new Command('check').description('Validate a built film').action(() => {
  throw new Error('check: not implemented yet');
});
