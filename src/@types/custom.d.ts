declare namespace Express {
  export interface Request {
    user: {
      sessionId: string;
      _id: string,
      role?: 'user' | 'admin',
    },
    access_token: string | null,
  }
}