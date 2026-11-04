import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { RequestSession } from './session.service';
import './tenant-request';

/** Workspace of the session behind SessionAuthGuard. */
export const CurrentWorkspace = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): RequestSession['workspace'] => {
    return ctx.switchToHttp().getRequest().tenant.workspace;
  },
);

/** User of the session behind SessionAuthGuard. */
export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): RequestSession['user'] => {
    return ctx.switchToHttp().getRequest().tenant.user;
  },
);
