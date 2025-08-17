// unpause-queues.ts
// Resume paused queues

import Bull from 'bull';

const scrapeQueue = new Bull('scrape-queue', {
  redis: {
    host: 'redis-13142.c62.us-east-1-4.ec2.redns.redis-cloud.com',
    port: 13142,
    password: 'Hie2Ze4t6SYBnozINBsJS2yeWWuURTz6'
  }
});

const alertQueue = new Bull('alert-queue', {
  redis: {
    host: 'redis-13142.c62.us-east-1-4.ec2.redns.redis-cloud.com',
    port: 13142,
    password: 'Hie2Ze4t6SYBnozINBsJS2yeWWuURTz6'
  }
});

async function unpauseQueues() {
  try {
    console.log('🔄 Checking queue status...\n');
    
    // Check if queues are paused
    const scrapePaused = await scrapeQueue.isPaused();
    const alertPaused = await alertQueue.isPaused();
    
    console.log('Scrape Queue paused:', scrapePaused);
    console.log('Alert Queue paused:', alertPaused);
    
    if (scrapePaused) {
      console.log('\n▶️ Resuming scrape queue...');
      await scrapeQueue.resume();
      console.log('✅ Scrape queue resumed');
    }
    
    if (alertPaused) {
      console.log('\n▶️ Resuming alert queue...');
      await alertQueue.resume();
      console.log('✅ Alert queue resumed');
    }
    
    // Check status after resuming
    console.log('\n📊 Current status:');
    const scrapeWaiting = await scrapeQueue.getWaitingCount();
    const scrapeActive = await scrapeQueue.getActiveCount();
    const scrapePausedAfter = await scrapeQueue.isPaused();
    
    console.log('Scrape Queue:');
    console.log('  - Paused:', scrapePausedAfter);
    console.log('  - Waiting jobs:', scrapeWaiting);
    console.log('  - Active jobs:', scrapeActive);
    
    // Process waiting jobs
    if (scrapeWaiting > 0 && !scrapePausedAfter) {
      console.log('\n🚀 Queue is ready to process waiting jobs!');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await scrapeQueue.close();
    await alertQueue.close();
    process.exit(0);
  }
}

unpauseQueues();