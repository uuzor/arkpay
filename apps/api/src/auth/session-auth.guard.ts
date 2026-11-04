import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { SessionService } from './session.service';
import { SESSION_COOKIE } from './tenant.constants';
import './tenant-request';

/**
 * Cookie-session guard. Applied per-route — never global: Telegram/PayPal
 * webhooks and machine paths (poller, scheduler) resolve the tenant from
 * pairing rows and credential state instead of a browser session.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const cookies = SessionService.parseCookies(req.headers?.cookie);
    const tenant = await this.sessions.resolve(cookies[SESSION_COOKIE]);
    if (!tenant) throw new UnauthorizedException('sign in required');
    req.tenant = tenant;
    return true;
  }
}
