import {
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import {
  CurrentUser,
  CurrentWorkspace,
} from './current-workspace.decorator';
import { GoogleAuthService } from './google-auth.service';
import { SessionService, type RequestSession } from './session.service';
import { SessionAuthGuard } from './session-auth.guard';
import { SESSION_COOKIE, SESSION_TTL_MS } from './tenant.constants';
import './tenant-request';
import { WorkspacesService } from './workspaces.service';

/**
 * Google sign-in + per-workspace Gmail connect. Browser flows end in a
 * redirect back to the web app (success → dashboard, failure → login with
 * ?error=). Error strings never carry secrets — the OAuth helpers only
 * report HTTP statuses.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly google: GoogleAuthService,
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
  ) {}

  /**
   * Shared cookie attributes. In production the OAuth callback lands on the
   * API host while the SPA runs on the app host, so the cookie must carry the
   * parent domain (`SESSION_COOKIE_DOMAIN`) or the SPA never receives it.
   */
  private cookieAttributes(): string {
    const secure =
      (process.env.API_PUBLIC_URL ?? '').startsWith('https://') ||
      process.env.NODE_ENV === 'production';
    const domain = (process.env.SESSION_COOKIE_DOMAIN ?? '').trim();
    return `; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}${
      domain ? `; Domain=${domain}` : ''
    }`;
  }

  private cookieHeader(token: string): string {
    return `${SESSION_COOKIE}=${token}${this.cookieAttributes()}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
  }

  @Get('google')
  googleLogin(@Res() res: Response): void {
    res.redirect(this.google.loginUrl());
  }

  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ): Promise<void> {
    const web = this.google.webAppUrl();
    const fail = (reason: string): void => {
      res.redirect(
        `${web}/login?error=${encodeURIComponent(reason.slice(0, 120))}`,
      );
    };
    try {
      if (!code || !state) return fail('missing code or state');
      this.google.verifyState(state, 'login');
      const { accessToken } = await this.google.exchangeCode(code, 'login');
      const profile = await this.google.fetchProfile(accessToken);
      const user = await this.prisma.user.upsert({
        where: { googleSub: profile.sub },
        create: {
          googleSub: profile.sub,
          email: profile.email,
          name: profile.name,
          avatarUrl: profile.picture,
        },
        update: {
          email: profile.email,
          name: profile.name,
          avatarUrl: profile.picture,
        },
      });
      await this.workspaces.provisionForUser(user.id, user.email);
      const { token } = await this.sessions.create(user.id);
      res.setHeader('Set-Cookie', this.cookieHeader(token));
      res.redirect(`${web}/dashboard`);
    } catch (e) {
      fail(e instanceof Error ? e.message : 'auth failed');
    }
  }

  @Get('gmail/connect')
  @UseGuards(SessionAuthGuard)
  gmailConnect(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Res() res: Response,
  ): void {
    res.redirect(this.google.gmailConnectUrl(workspace.id));
  }

  @Get('gmail/callback')
  async gmailCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ): Promise<void> {
    const web = this.google.webAppUrl();
    const fail = (reason: string): void => {
      res.redirect(
        `${web}/settings?error=${encodeURIComponent(reason.slice(0, 120))}`,
      );
    };
    try {
      if (!code || !state) return fail('missing code or state');
      const { workspaceId } = this.google.verifyState(state, 'gmail');
      if (workspaceId === '-') return fail('bad state');
      const workspace = await this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { id: true },
      });
      if (!workspace) return fail('workspace no longer exists');
      const { accessToken, refreshToken } = await this.google.exchangeCode(
        code,
        'gmail',
      );
      if (!refreshToken) {
        return fail('Google did not return a refresh token — try again');
      }
      const address = await this.google.fetchGmailAddress(accessToken);
      await this.workspaces.connectGmail(workspaceId, refreshToken, address);
      res.redirect(`${web}/settings?connected=gmail`);
    } catch (e) {
      fail(e instanceof Error ? e.message : 'gmail connect failed');
    }
  }

  @Post('logout')
  async logout(@Req() req: Request, @Res() res: Response): Promise<void> {
    const token = SessionService.parseCookies(req.headers.cookie)[
      SESSION_COOKIE
    ];
    await this.sessions.destroy(token);
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE}=${this.cookieAttributes()}; Max-Age=0`,
    );
    // Explicit 200: Nest pre-sets 201 on POST responses.
    res.status(200).json({ ok: true });
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  me(
    @CurrentUser() user: RequestSession['user'],
    @CurrentWorkspace() workspace: RequestSession['workspace'],
  ) {
    return { user, workspace };
  }
}
