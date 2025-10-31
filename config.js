import dotenv from 'dotenv';
dotenv.config();

export const config = {
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    groupId: process.env.TELEGRAM_GROUP_ID,
    rickBurpUsername: process.env.RICKBURP_BOT_USERNAME || '@RickBurpBot',
    rickReplyWaitMs: process.env.RICK_REPLY_WAIT_MS ? parseInt(process.env.RICK_REPLY_WAIT_MS) : 15000,
    user: {
      apiId: process.env.TELEGRAM_API_ID ? parseInt(process.env.TELEGRAM_API_ID) : null,
      apiHash: process.env.TELEGRAM_API_HASH || null,
      phoneNumber: process.env.TELEGRAM_PHONE_NUMBER || null,
      password: process.env.TELEGRAM_2FA_PASSWORD || null,
      sessionString: process.env.TELEGRAM_USER_SESSION || null,
      sessionFile: process.env.TELEGRAM_USER_SESSION_FILE || 'data/user.session'
    }
  },
  bnb: {
    rpcUrl: process.env.BNB_RPC_URL || 'https://bsc-dataseed1.binance.org/',
    privateKey: process.env.BNB_PRIVATE_KEY,
    routerAddress: process.env.BNB_ROUTER_ADDRESS || '0x10ED43C718714eb63d5aA57B78B54704E256024E',
    factoryAddress: process.env.BNB_FACTORY_ADDRESS || '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
    wbnbAddress: process.env.BNB_WBNB_ADDRESS || '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'
  },
  solana: {
    rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    privateKey: process.env.SOLANA_PRIVATE_KEY,
    jupiterApiUrl: process.env.JUPITER_API_URL || 'https://quote-api.jup.ag/v6'
  },
  trading: {
    maxMarketCapThreshold: parseInt(process.env.MAX_MARKET_CAP_THRESHOLD) || 500000,
    minLiquidityUsd: parseInt(process.env.MIN_LIQUIDITY_USD) || 10000,
    maxSlippagePercent: parseFloat(process.env.MAX_SLIPPAGE_PERCENT) || 2,
    maxPositionSizeUsd: parseInt(process.env.MAX_POSITION_SIZE_USD) || 1000,
    maxConcurrentPositions: parseInt(process.env.MAX_CONCURRENT_POSITIONS) || 5
  },
  ai: {
    provider: process.env.AI_PROVIDER || 'anthropic',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    claudeModel: process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-latest',
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
    openrouterModel: process.env.OPENROUTER_MODEL || 'anthropic/claude-3.5-sonnet'
  },
  analysis: {
    minSentimentScore: parseFloat(process.env.MIN_SENTIMENT_SCORE) || 0.6,
    minInfluenceScore: parseFloat(process.env.MIN_INFLUENCE_SCORE) || 0.7,
    recentlyLaunchedHours: parseInt(process.env.RECENTLY_LAUNCHED_HOURS) || 48
  },
  schedule: {
    checkIntervalHours: parseInt(process.env.CHECK_INTERVAL_HOURS) || 4,
    checkIntervalMinutes: process.env.CHECK_INTERVAL_MINUTES ? parseInt(process.env.CHECK_INTERVAL_MINUTES) : null,
    cron: process.env.SCHEDULE_CRON || null
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info'
  },
  wallets: {
    passphrase: process.env.WALLETS_PASSPHRASE || null
  }
};

// Validate required configuration
export function validateConfig() {
  const required = [
    'telegram.botToken',
    'telegram.groupId',
    'bnb.privateKey',
    'solana.privateKey'
  ];

  const missing = [];
  for (const path of required) {
    const keys = path.split('.');
    let value = config;
    for (const key of keys) {
      value = value[key];
      if (!value) {
        missing.push(path);
        break;
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required configuration: ${missing.join(', ')}`);
  }

  // AI provider-specific validation
  if (config.ai.provider === 'openrouter') {
    if (!config.ai.openrouterApiKey) {
      throw new Error('Missing OPENROUTER_API_KEY for AI provider openrouter');
    }
  } else {
    if (!config.ai.anthropicApiKey) {
      throw new Error('Missing ANTHROPIC_API_KEY for AI provider anthropic');
    }
  }
}
