import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

export const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export const S3_BUCKET = process.env.S3_BUCKET_NAME || 'telegram-channel-data';

export async function uploadBufferToS3(
  key: string,
  buf: Buffer,
  contentType: string
): Promise<string> {
  await s3Client.send(
    new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: buf, ContentType: contentType })
  );
  const region = process.env.AWS_REGION || 'us-east-1';
  return `https://${S3_BUCKET}.s3.${region}.amazonaws.com/${key}`;
}