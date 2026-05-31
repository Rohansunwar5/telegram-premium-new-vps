// check-processors.ts
// Check if processors are actually registered and working

import Bull from 'bull';

const scrapeQueue = new Bull('scrape-queue', {
  redis: {
    host: 'redis-13142.c62.us-east-1-4.ec2.redns.redis-cloud.com',
    port: 13142,
    password: 'Hie2Ze4t6SYBnozINBsJS2yeWWuURTz6'
  }
});

async function checkProcessors() {
  try {
    console.log('🔍 Checking queue processors...\n');

    // Add a simple test job
    console.log('Adding test job...');
    const testJob = await scrapeQueue.add('test-processor', {
      test: true,
      timestamp: new Date().toISOString()
    });

    console.log(`Test job added: ${testJob.id}`);

    // Register a test processor
    console.log('\nRegistering test processor...');
    scrapeQueue.process('test-processor', async (job) => {
      console.log('✅ Test processor is working!');
      console.log('Job data:', job.data);
      return { success: true, processed: new Date().toISOString() };
    });

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Check job status
    const job = await scrapeQueue.getJob(testJob.id);
    if (job) {
      const state = await job.getState();
      console.log(`\nTest job state: ${state}`);

      if (state === 'completed') {
        console.log('✅ Processor is working correctly!');
      } else {
        console.log('⚠️ Processor might not be working. Job is still:', state);
      }
    }

    // Check for actual scrape-channel jobs
    const waitingJobs = await scrapeQueue.getJobs(['waiting']);
    const activeJobs = await scrapeQueue.getJobs(['active']);

    console.log('\n📊 Scrape-channel jobs:');
    console.log('Waiting:', waitingJobs.filter(j => j.name === 'scrape-channel').length);
    console.log('Active:', activeJobs.filter(j => j.name === 'scrape-channel').length);

    // Clean up test job
    if (testJob) {
      await testJob.remove();
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    setTimeout(() => {
      scrapeQueue.close();
      process.exit(0);
    }, 5000);
  }
}

checkProcessors();