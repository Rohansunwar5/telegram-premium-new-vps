import { describe, it, expect } from 'vitest';
import { encode, decode, generateKey } from '../crypto.service';

describe('crypto.service', () => {
  it('round-trips a string through encode/decode', async () => {
    const key = await generateKey();
    const enc = await encode('hello world', key);
    const dec = await decode(enc, key);
    expect(dec).toBe('hello world');
  });

  it('throws when the ciphertext is tampered with', async () => {
    const key = await generateKey();
    const enc = await encode('secret', key);
    // Append a byte so the ciphertext is no longer a whole number of blocks.
    const tampered = { ...enc, encryptedData: enc.encryptedData + '00' };
    await expect(decode(tampered, key)).rejects.toThrow();
  });
});
