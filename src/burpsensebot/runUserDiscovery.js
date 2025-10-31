import { config } from '../../config.js';
import { BurpSenseBot } from './index.js';
import { UserTelegramClient } from '../telegram/userClient.js';
import { logger } from '../utils/logger.js';

async function main() {
  const chatId = String(config.telegram.groupId || '').trim();
  if (!chatId) {
    throw new Error('Missing TELEGRAM_GROUP_ID (target chat for summary)');
  }

  const userClient = new UserTelegramClient();
  await userClient.init();
  if (!userClient.ready) {
    throw new Error('Telegram user client not ready. Ensure TELEGRAM_USER_SESSION is configured.');
  }

  const burpSenseBot = new BurpSenseBot({
    bot: null,
    getMessages: () => [],
    getUserClient: () => userClient,
    sendAlert: async (message, targetChatId) => {
      if (!targetChatId) return;
      await userClient.sendText(targetChatId, message);
    }
  });

  const result = await burpSenseBot.queryRickBurpBot(chatId);
  if (!result) {
    logger.warn('No data returned from RickBurpBot');
    process.exit(1);
  }

  logger.info(`Discovery complete. EVM=${result.evmAddresses.length} SOL=${result.solanaAddresses.length}`);
}

main().catch((err) => {
  console.error('runUserDiscovery failed:', err);
  process.exit(1);
});
