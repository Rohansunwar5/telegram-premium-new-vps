/**
 * Regenerate a dead sessionString for a decoy Telegram account.
 * Run: node scripts/regenerate-session.js
 *
 * - Connects to MongoDB using MONGO_URI / DB_URI from .env
 * - Lists all decoy accounts
 * - Lets you pick one and logs back in via phone + OTP
 * - Saves the fresh sessionString straight to the DB
 */

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const mongoose = require('mongoose');
const readline = require('readline');
require('dotenv').config();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

async function main() {
  // ── DB connect ─────────────────────────────────────────────────────────────
  const uri = process.env.MONGO_URI || process.env.DB_URI;
  if (!uri) { console.error('No MONGO_URI / DB_URI in .env'); process.exit(1); }
  await mongoose.connect(uri);
  console.log('Connected to MongoDB\n');

  const col = mongoose.connection.db.collection('decoytelegramaccounts');
  const accounts = await col.find({}).toArray();

  if (!accounts.length) { console.log('No decoy accounts found.'); process.exit(0); }

  // ── List accounts ───────────────────────────────────────────────────────────
  console.log('Decoy accounts:');
  accounts.forEach((a, i) =>
    console.log(`  [${i}] ${a.phoneNumber}  (id: ${a._id})`)
  );

  const idx = parseInt(await ask('\nEnter the number of the account to regenerate: '), 10);
  if (isNaN(idx) || idx < 0 || idx >= accounts.length) {
    console.error('Invalid selection'); process.exit(1);
  }

  const acc = accounts[idx];
  console.log(`\nRegenerating session for ${acc.phoneNumber} ...`);
  console.log('Telegram will send an OTP to this number (or to your Telegram app if active).\n');

  // ── GramJS login flow ───────────────────────────────────────────────────────
  const client = new TelegramClient(
    new StringSession(''),   // empty = fresh login
    acc.apiId,
    acc.apiHash,
    { connectionRetries: 5 }
  );

  await client.start({
    phoneNumber:   async () => acc.phoneNumber,
    phoneCode:     async () => ask('Enter the OTP code you received: '),
    password:      async () => ask('Enter 2FA password (or press Enter to skip): '),
    onError:       (err) => console.error('Login error:', err.message),
  });

  const newSession = client.session.save();
  console.log('\nLogin successful!');

  // ── Save to DB ──────────────────────────────────────────────────────────────
  await col.updateOne(
    { _id: acc._id },
    { $set: { sessionString: newSession } }
  );
  console.log(`SessionString updated in DB for ${acc.phoneNumber}`);
  console.log('\nNext steps:');
  console.log('  1. Deploy / restart the server so it picks up the new sessionString');
  console.log('  2. Resume the paused sessions from the dashboard');

  await client.disconnect();
  rl.close();
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  rl.close();
  process.exit(1);
});
