// PM2 process definition for the production server.
//
// CRITICAL: exec_mode must be 'fork' with instances:1. The app's own index.ts
// runs Node's cluster module internally — the master process owns the single
// DecoyBot (one MTProto connection per decoy session string; Telegram permits
// only ONE live connection per auth key) and forks the HTTP workers itself.
// If PM2 also clustered (exec_mode:'cluster' / instances:>1) there would be
// multiple masters, each resuming the same decoy sessions → permanent
// AUTH_KEY_DUPLICATED. PM2 must launch exactly one process.
//
// kill_timeout + wait_ready give a clean handoff on deploy/restart: PM2 waits
// up to 30s for the old master to disconnect every decoy session from Telegram
// (graceful shutdown calls stopAllSessions) before the new master connects.
// Deploy with:  pm2 startOrReload ecosystem.config.js --update-env
module.exports = {
  apps: [
    {
      name: 'telegram-premium-server',
      script: 'dist/index.js',
      exec_mode: 'fork',
      instances: 1,
      kill_timeout: 30000,
      wait_ready: true,
      listen_timeout: 15000,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        DECOY_BOT_ENABLED: 'true',
      },
    },
  ],
};
