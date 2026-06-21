import 'dotenv/config';
import { loadConfig } from './config.js';
import { runOnce } from './service.js';
import { createTranslator } from './translator.js';

const once = process.argv.includes('--once');

async function execute(config, translateBatch) {
  const started = new Date();
  console.info(`[run] ${started.toISOString()}`);
  const result = await runOnce(config, { translateBatch });
  console.info(`[done] translated=${result.translated} failed=${result.failed} output=${result.outputItems}`);
}

async function main() {
  const config = loadConfig();
  const translateBatch = createTranslator(config);

  if (once) {
    await execute(config, translateBatch);
    return;
  }

  let stopping = false;
  let wakeFromSleep;
  const stop = () => {
    stopping = true;
    wakeFromSleep?.();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  while (!stopping) {
    try {
      await execute(config, translateBatch);
    } catch (error) {
      console.error(`[run] ${error.stack ?? error.message}`);
    }
    if (!stopping) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, config.pollIntervalMinutes * 60_000);
        wakeFromSleep = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      wakeFromSleep = undefined;
    }
  }
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
