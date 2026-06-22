import 'dotenv/config';
import { loadConfig } from './config.js';
import { runOnce } from './service.js';
import { createTranslator } from './translator.js';
import { createSlackNotifier } from './slack.js';
import { createGitHubPagesPublisher } from './pages.js';

const once = process.argv.includes('--once');

async function execute(config, translateBatch, notifySlack, publishPages) {
  const started = new Date();
  console.info(`[run] ${started.toISOString()}`);
  const result = await runOnce(config, { translateBatch, notifySlack });
  let pages = 'disabled';
  if (publishPages) {
    try {
      pages = await publishPages();
      console.info(`[pages] ${pages}`);
    } catch (error) {
      pages = 'failed';
      console.error(`[pages] failed: ${error.message}`);
    }
  }
  console.info(`[done] translated=${result.translated} failed=${result.failed} slackSent=${result.slackSent} slackFailed=${result.slackFailed} pages=${pages} output=${result.outputItems}`);
}

async function main() {
  const config = loadConfig();
  const translateBatch = createTranslator(config);
  const notifySlack = createSlackNotifier(config);
  const publishPages = createGitHubPagesPublisher(config);

  if (!notifySlack) {
    console.warn('[slack] SLACK_WEBHOOK_URL is not set; Slack notifications are disabled.');
  }
  if (!publishPages) {
    console.warn('[pages] GITHUB_PAGES_TOKEN or GITHUB_REPOSITORY is not set; GitHub Pages publishing is disabled.');
  }

  if (once) {
    await execute(config, translateBatch, notifySlack, publishPages);
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
      await execute(config, translateBatch, notifySlack, publishPages);
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
