// services/s3.service.ts
import AWS from 'aws-sdk';
import config from '../config';
import { InternalServerError } from '../errors/internal-server.error';
import logger from '../utils/logger';

export class S3Service {
  private s3: AWS.S3;
  private bucketName: string;

  constructor() {
    const bucketName = config.S3_BUCKET_NAME || 'telegram-scraper-bucket-73640';
    
    logger.info('S3 Service initializing with:', {
      accessKeyId: config.AWS_ACCESS_KEY_ID ? '✅ Set' : '❌ Not set',
      secretAccessKey: config.AWS_SECRET_ACCESS_KEY ? '✅ Set' : '❌ Not set',
      region: config.AWS_REGION || 'us-east-1',
      bucketName: bucketName
    });

    if (!config.AWS_ACCESS_KEY_ID || !config.AWS_SECRET_ACCESS_KEY) {
      throw new Error('AWS credentials not configured. Please set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY');
    }

    if (!bucketName) {
      throw new Error('S3 bucket name not configured. Please set S3_BUCKET_NAME in environment variables');
    }

    this.s3 = new AWS.S3({
      accessKeyId: config.AWS_ACCESS_KEY_ID,
      secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
      region: config.AWS_REGION || 'us-east-1'
    });
    
    this.bucketName = bucketName;
    logger.info(`✅ S3 Service initialized with bucket: ${this.bucketName}`);
  }

  async uploadJson(key: string, data: any): Promise<string> {
    try {
      if (!this.bucketName) {
        throw new Error('Bucket name is not configured');
      }

      const params = {
        Bucket: this.bucketName,
        Key: key,
        Body: JSON.stringify(data),
        ContentType: 'application/json'
      };

      logger.info(`📤 Uploading to S3: ${params.Bucket}/${params.Key}`);

      const result = await this.s3.upload(params).promise();
      logger.info(`✅ S3 upload successful: ${result.Location}`);
      
      return result.Location;
    } catch (error: any) {
      logger.error('❌ Error uploading to S3:', {
        error: error.message,
        bucket: this.bucketName,
        key: key
      });
      throw new InternalServerError(`Failed to upload data to S3: ${error.message}`);
    }
  }

  async getJson(key: string): Promise<any> {
    try {
      const params = {
        Bucket: this.bucketName,
        Key: key
      };

      logger.info(`📥 Retrieving from S3: ${params.Bucket}/${params.Key}`);

      const result = await this.s3.getObject(params).promise();
      const data = result.Body?.toString('utf-8');
      
      if (!data) {
        throw new Error('No data found in S3 object');
      }

      return JSON.parse(data);
    } catch (error: any) {
      logger.error('❌ Error retrieving from S3:', {
        error: error.message,
        bucket: this.bucketName,
        key: key
      });
      throw new InternalServerError(`Failed to retrieve data from S3: ${error.message}`);
    }
  }

  async deleteObject(key: string): Promise<void> {
    try {
      const params = {
        Bucket: this.bucketName,
        Key: key
      };

      await this.s3.deleteObject(params).promise();
      logger.info(`🗑️ Deleted from S3: ${params.Bucket}/${params.Key}`);
    } catch (error: any) {
      logger.error('❌ Error deleting from S3:', error);
      throw new InternalServerError('Failed to delete data from S3');
    }
  }

  async listObjects(prefix: string): Promise<AWS.S3.ObjectList> {
    try {
      const params = {
        Bucket: this.bucketName,
        Prefix: prefix
      };

      const result = await this.s3.listObjectsV2(params).promise();
      return result.Contents || [];
    } catch (error: any) {
      logger.error('❌ Error listing S3 objects:', error);
      throw new InternalServerError('Failed to list S3 objects');
    }
  }

  async deleteMultipleObjects(keys: string[]): Promise<void> {
    try {
      if (keys.length === 0) return;

      const params = {
        Bucket: this.bucketName,
        Delete: {
          Objects: keys.map(key => ({ Key: key }))
        }
      };

      await this.s3.deleteObjects(params).promise();
      logger.info(`🗑️ Deleted ${keys.length} objects from S3`);
    } catch (error: any) {
      logger.error('❌ Error deleting multiple objects from S3:', error);
      throw new InternalServerError('Failed to delete multiple objects from S3');
    }
  }
}