// test-scrape.ts
// Manually test the scraping workflow

import Bull from 'bull';

const scrapeQueue = new Bull('scrape-queue', {
  redis: {
    host: 'redis-13142.c62.us-east-1-4.ec2.redns.redis-cloud.com',
    port: 13142,
    password: 'Hie2Ze4t6SYBnozINBsJS2yeWWuURTz6'
  }
});

async function testScrape() {
  try {
    console.log('🧪 Adding test scrape job...\n');
    
    // Add a test scrape job
    const job = await scrapeQueue.add('scrape-channel', {
      bookmarkId: 'test-bookmark-123',
      channelId: 'test-channel-id',
      channelName: 'Cdma66', // Use a real channel name you know works
      isInitial: true
    }, {
      delay: 0, // Process immediately
      attempts: 1
    });
    
    console.log(`✅ Job added with ID: ${job.id}`);
    console.log('Job data:', job.data);
    
    // Monitor job progress
    console.log('\n⏳ Monitoring job progress...');
    
    let completed = false;
    let attempts = 0;
    const maxAttempts = 30; // Wait max 30 seconds
    
    while (!completed && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
      
      const updatedJob = await scrapeQueue.getJob(job.id);
      if (updatedJob) {
        const state = await updatedJob.getState();
        console.log(`Job state: ${state}`);
        
        if (state === 'completed') {
          console.log('✅ Job completed successfully!');
          console.log('Result:', updatedJob.returnvalue);
          completed = true;
        } else if (state === 'failed') {
          console.log('❌ Job failed!');
          console.log('Error:', updatedJob.failedReason);
          completed = true;
        } else if (state === 'active') {
          console.log('🔄 Job is being processed...');
        }
      }
      
      attempts++;
    }
    
    if (!completed) {
      console.log('⏱️ Job timed out - it might still be processing');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await scrapeQueue.close();
    process.exit(0);
  }
}

testScrape();