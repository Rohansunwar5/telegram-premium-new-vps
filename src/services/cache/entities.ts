import CacheManager from './manager';

interface IEncodedJWTCacheResponse {
  iv: string;
  encryptedData: string;
}

interface IEncodedJWTCacheManagerParams {
  userId: string;
  sessionId: string;
}

interface IProfileCacheManagerParams {
  userId: string;
}

const encodedJWTCacheManager = CacheManager<IEncodedJWTCacheManagerParams, IEncodedJWTCacheResponse>('encoded-JWT', 86400);
const profileCacheManager = CacheManager<IProfileCacheManagerParams>('profile', 360);

export {
  encodedJWTCacheManager,
  profileCacheManager,
};