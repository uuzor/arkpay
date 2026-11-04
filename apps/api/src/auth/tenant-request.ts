import type { RequestSession } from './session.service';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by SessionAuthGuard; absent on unauthenticated requests. */
      tenant?: RequestSession;
    }
  }
}

export {};
