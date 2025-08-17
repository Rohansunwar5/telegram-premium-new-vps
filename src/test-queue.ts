// test-queue.ts
// Run this to test if queues are working

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

async function testQueues() {
  try {
    console.log('Testing queue connections...\n');
    
    // Check queue health
    const scrapeHealth = await scrapeQueue.isReady();
    const alertHealth = await alertQueue.isReady();
    
    console.log('✅ Scrape queue connected:', scrapeHealth);
    console.log('✅ Alert queue connected:', alertHealth);
    
    // Check existing jobs
    const waitingJobs = await scrapeQueue.getJobs(['waiting']);
    const delayedJobs = await scrapeQueue.getJobs(['delayed']);
    const activeJobs = await scrapeQueue.getJobs(['active']);
    const completedJobs = await scrapeQueue.getJobs(['completed']);
    const failedJobs = await scrapeQueue.getJobs(['failed']);
    
    console.log('\n📊 Scrape Queue Status:');
    console.log('- Waiting jobs:', waitingJobs.length);
    console.log('- Delayed jobs:', delayedJobs.length);
    console.log('- Active jobs:', activeJobs.length);
    console.log('- Completed jobs:', completedJobs.length);
    console.log('- Failed jobs:', failedJobs.length);
    
    // Show details of waiting/delayed jobs
    if (waitingJobs.length > 0) {
      console.log('\n⏳ Waiting Jobs:');
      waitingJobs.forEach(job => {
        console.log(`  - Job ${job.id}: ${job.name}`, job.data);
      });
    }
    
    if (delayedJobs.length > 0) {
      console.log('\n⏰ Delayed Jobs:');
      delayedJobs.forEach(job => {
        console.log(`  - Job ${job.id}: ${job.name}`, job.data);
        console.log(`    Delay: ${new Date(job.timestamp + (job.opts.delay || 0))}`);
      });
    }
    
    if (failedJobs.length > 0) {
      console.log('\n❌ Failed Jobs:');
      failedJobs.forEach(job => {
        console.log(`  - Job ${job.id}: ${job.name}`, job.failedReason);
      });
    }
    
    // Test adding a job
    console.log('\n🧪 Testing job addition...');
    const testJob = await scrapeQueue.add('test-job', {
      test: true,
      timestamp: new Date().toISOString()
    });
    console.log('✅ Test job added:', testJob.id);
    
    // Clean up test job
    await testJob.remove();
    console.log('🧹 Test job removed');
    
    // Check for processors
    console.log('\n🔍 Checking for active processors...');
    const workers = await scrapeQueue.getWorkers();
    console.log('Workers:', workers.length);
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await scrapeQueue.close();
    await alertQueue.close();
    process.exit(0);
  }
}

testQueues();