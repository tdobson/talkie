import { Command } from 'commander';
import { exportFilm, type ExportOptions } from '../export/export';

export const exportCommand = new Command('export')
  .description('Render a film to video')
  .argument('<film>', 'a film folder or a .lottie file')
  .requiredOption('-o, --out <file>', 'the video to write: .mp4, .mkv or .webm')
  .option('--codec <codec>', 'h264, h265 or av1', 'h264')
  .option('--audio <codec>', 'aac, or opus for .mkv and .webm (default: aac, or opus for .webm)')
  .option('--size <size>', '720p, 1080p, 4k or <W>x<H>', '1080p')
  .option('--from <seconds>', 'film time to start at', '0')
  .option('--to <seconds>', 'film time to stop at (default: the end of the film)')
  .option('--captions <mode>', 'burn, track or none', 'none')
  .option('--fps <fps>', 'frames per second', '25')
  .option('--allow-here', 'render even on tragicomix (small test exports only)', false)
  .action(async (film: string, options: ExportOptions) => {
    const done = await exportFilm(film, options);
    const { plan } = done;
    process.stdout.write(
      `Exported ${done.frames} frames (${done.held} held) at ${plan.size[0]}x${plan.size[1]}, ${plan.codec} and ${plan.audio}\n  ${done.out}\n`
    );
  });
