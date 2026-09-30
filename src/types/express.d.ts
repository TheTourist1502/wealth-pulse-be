declare global {
  namespace Express {
    interface Request {
      // Set by `authenticate`; only present on protected routes.
      userId: string;
    }
  }
}

export {};
