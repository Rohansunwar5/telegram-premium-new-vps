/**
 * GramJS Session String Generator
 *
 * Logs into a Telegram account via OTP and prints the StringSession.
 * Run once per decoy phone number, then paste the output into the admin panel.
 *
 * Usage:
 *   node scripts/generate-session.js
 *
 * Prerequisites:
 *   - Node.js 18+
 *   - npm install (telegram and input packages already in package.json)
 *   - Have your apiId, apiHash, and phone number ready (from my.telegram.org)
 */

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (question) => new Promise((resolve) => rl.question(question, resolve));

(async () => {
  console.log('\n=== Darkmap Decoy Account Session Generator ===\n');

  const apiIdStr  = await ask('Enter API ID    : ');
  const apiHash   = await ask('Enter API Hash  : ');
  const phone     = await ask('Enter Phone (+) : ');

  const apiId = parseInt(apiIdStr, 10);
  if (isNaN(apiId)) {
    console.error('ERROR: API ID must be a number');
    process.exit(1);
  }

  const client = new TelegramClient(
    new StringSession(''),
    apiId,
    apiHash,
    { connectionRetries: 3 }
  );

  await client.start({
    phoneNumber: async () => phone,
    phoneCode: async () => {
      return await ask('Enter the OTP sent to your Telegram app: ');
    },
    password: async () => {
      return await ask('Enter 2FA password (leave blank if none): ');
    },
    onError: (err) => {
      console.error('Login error:', err.message);
    },
  });

  const sessionString = client.session.save();

  console.log('\n✅ Login successful!\n');
  console.log('========== SESSION STRING (copy everything below) ==========');
  console.log(sessionString);
  console.log('=============================================================\n');
  console.log('Paste this into the Admin Panel → Add Account → Session String field.\n');

  await client.disconnect();
  rl.close();
  process.exit(0);
})();
