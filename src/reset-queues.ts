// reset-queues.ts
// Complete reset of queues

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

async function resetQueues() {
  try {
    console.log('🔄 Resetting queues...\n');
    
    // Resume queues first
    await scrapeQueue.resume();
    await alertQueue.resume();
    console.log('✅ Queues resumed');
    
    // Empty the queues
    await scrapeQueue.empty();
    await alertQueue.empty();
    console.log('✅ Queues emptied');
    
    // Clean all jobs
    await scrapeQueue.clean(0, 'completed');
    await scrapeQueue.clean(0, 'failed');
    await scrapeQueue.clean(0, 'delayed');
    await scrapeQueue.clean(0, 'wait');
    console.log('✅ All jobs cleaned');
    
    // Remove all repeatable jobs
    const repeatableJobs = await alertQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      await alertQueue.removeRepeatableByKey(job.key);
    }
    console.log('✅ Repeatable jobs removed');
    
    // Final status
    console.log('\n📊 Final Status:');
    console.log('Scrape Queue:');
    console.log('  - Paused:', await scrapeQueue.isPaused());
    console.log('  - Waiting:', await scrapeQueue.getWaitingCount());
    console.log('  - Active:', await scrapeQueue.getActiveCount());
    console.log('  - Delayed:', await scrapeQueue.getDelayedCount());
    console.log('  - Failed:', await scrapeQueue.getFailedCount());
    
    console.log('\nAlert Queue:');
    console.log('  - Paused:', await alertQueue.isPaused());
    console.log('  - Repeatable jobs:', (await alertQueue.getRepeatableJobs()).length);
    
    console.log('\n✅ Queues have been completely reset!');
    console.log('You can now create new bookmarks and they should process correctly.');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await scrapeQueue.close();
    await alertQueue.close();
    process.exit(0);
  }
}

resetQueues();