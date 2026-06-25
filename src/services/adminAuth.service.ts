import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { customAlphabet } from 'nanoid';
import config from '../config';
import { AdminRepository } from '../repository/admin.repository';
import { NotFoundError } from '../errors/not-found.error';
import { UnauthorizedError } from '../errors/unauthorized.error';
import { BadRequestError } from '../errors/bad-request.error';
import { InternalServerError } from '../errors/internal-server.error';
import { encode, encryptionKey } from './crypto.service';
import { encodedJWTCacheManager } from './cache/entities';

const nanoid = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 16);

class AdminAuthService {
  constructor(private readonly adminRepo: AdminRepository) {}

  async login(params: { email: string; password: string }) {
    const { email, password } = params;

    const admin = await this.adminRepo.findByEmail(email);
    if (!admin) throw new NotFoundError('Admin not found');

    const valid = await bcrypt.compare(password, admin.password);
    if (!valid) throw new UnauthorizedError('Invalid email or password');

    const accessToken = await this._generateToken(admin._id.toString());
    if (!accessToken) throw new InternalServerError('Failed to generate access token');

    return { accessToken };
  }

  async createAdmin(params: { email: string; password: string }) {
    const existing = await this.adminRepo.findByEmail(params.email);
    if (existing) throw new BadRequestError('Admin with this email already exists');

    const hashed = await bcrypt.hash(params.password, 10);
    const admin = await this.adminRepo.create({ email: params.email, password: hashed });

    const accessToken = await this._generateToken(admin._id.toString());
    return { accessToken };
  }

  private async _generateToken(adminId: string): Promise<string> {
    const sessionId = nanoid();

    const token = jwt.sign(
      { _id: adminId, sessionId, role: 'admin' },
      config.ADMIN_JWT_SECRET,
      { expiresIn: '24h' }
    );

    const key = await encryptionKey(config.JWT_CACHE_ENCRYPTION_KEY);
    const encrypted = await encode(token, key);
    await encodedJWTCacheManager.set({ userId: adminId, sessionId }, encrypted);

    return token;
  }
}

export default new AdminAuthService(new AdminRepository());
