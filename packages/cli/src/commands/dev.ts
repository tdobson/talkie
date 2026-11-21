import { Command } from 'commander';
import { startDev } from '../dev/server';

export const devCommand = new Command('dev')
  .description('Build, serve and watch a film project')
  .argument('[dir]', 'the film project folder', '.')
  .option('--port <port>', 'port to serve the preview on', '4321')
  .action(async (dir: string, options: { port: string }) => {
    const port = Number(options.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error('port must be a whole number from 0 to 65535');
    }
    const server = await startDev(dir, { port });
    process.stdout.write(`Preview at ${server.url}\nWatching for changes. Press Ctrl+C to stop.\n`);
    await new Promise<void>((done) => {
      process.once('SIGINT', () => {
        void server.close().then(done);
      });
    });
  });
