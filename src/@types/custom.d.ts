declare namespace Express {
  export interface Request {
    user: {
      sessionId: string;
      _id: string,
    },
    access_token: string | null,
  }
}