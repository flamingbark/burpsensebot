## BurpSenseBot

This project contains the MTProto helper that powers the BurpSense workflow. It
can:

- Post `/tt@rick` and `/xt@rick` in a target chat using a Telegram **user session only** (RickBurpBot ignores Bot API messages).
- Wait for RickBurpBot's reply and parse it for URLs, profile handles, and raw
  contract addresses.
- Fetch those URLs through Nitter mirrors to extract any additional contract
  addresses that appear on the referenced tweets or profiles.
- Send a concise "Latest Burp Smells" summary back into the chat.

### Quick start

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a `.env` file with your Telegram MTProto credentials (see
   `config.js` for the expected variables).

3. Run the MTProto-only discovery loop:

   ```bash
   npm run burpsense:user
   ```

The script will use your Telegram user's session to communicate with
RickBurpBot, extract contract addresses, and post the summary into the same
chat.
