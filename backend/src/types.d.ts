import type { SessionUser } from '@sherm/shared';

declare module 'express-serve-static-core' {
  interface Request {
    user?: SessionUser;
    sessionTokenHash?: string;
  }
}
