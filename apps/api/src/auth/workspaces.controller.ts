import {
  Body,
  Controller,
  Get,
  Patch,
  UseGuards,
} from '@nestjs/common';
import {
  CurrentWorkspace,
} from './current-workspace.decorator';
import type { RequestSession } from './session.service';
import { SessionAuthGuard } from './session-auth.guard';
import './tenant-request';
import { WorkspacesService } from './workspaces.service';

interface UpdateProfileBody {
  name?: string;
  timezone?: string;
  currency?: string;
}

interface ConnectPaypalBody {
  clientId?: string;
  clientSecret?: string;
  mode?: string;
  webhookId?: string;
}

/**
 * The caller's own workspace: profile, connection status (secrets never
 * returned), and the PayPal credential form. Guarded from day one — these
 * routes have no legacy unauthenticated callers.
 */
@Controller('workspaces')
@UseGuards(SessionAuthGuard)
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get('me')
  me(@CurrentWorkspace() workspace: RequestSession['workspace']) {
    return this.workspaces.profile(workspace.id);
  }

  @Patch('me')
  update(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Body() body: UpdateProfileBody,
  ) {
    const payload = body ?? {};
    return this.workspaces.updateProfile(workspace.id, {
      ...(payload.name !== undefined ? { name: payload.name } : {}),
      ...(payload.timezone !== undefined ? { timezone: payload.timezone } : {}),
      ...(payload.currency !== undefined ? { currency: payload.currency } : {}),
    });
  }

  @Patch('me/paypal')
  connectPaypal(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Body() body: ConnectPaypalBody,
  ) {
    return this.workspaces.connectPaypal(workspace.id, body ?? {});
  }
}
