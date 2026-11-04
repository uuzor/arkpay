import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentWorkspace } from '../../auth/current-workspace.decorator';
import type { RequestSession } from '../../auth/session.service';
import { SessionAuthGuard } from '../../auth/session-auth.guard';
import { PaypalWebhooksService } from './webhooks.service';

/**
 * PayPal event receiver. Answers 200 fast on every verified event (duplicate
 * deliveries included); forgeries and unattributed events get 401 and touch
 * nothing. The setup helpers below are session-guarded; the receiver is
 * authenticated by the PayPal signature instead.
 */
@Controller('paypal')
export class PaypalWebhooksController {
  constructor(private readonly webhooks: PaypalWebhooksService) {}

  @Post('webhook')
  async webhook(@Req() req: Request, @Res() res: Response): Promise<void> {
    const started = Date.now();
    const out = await this.webhooks.handle(req.headers, req.body);
    if (out.outcome === 'unverified') {
      res.status(401).json({ ok: false, reason: out.detail ?? 'bad signature' });
      return;
    }
    if (out.outcome === 'not_configured') {
      res.status(500).json({ ok: false, reason: 'webhook id not configured' });
      return;
    }
    res
      .status(200)
      .json({ ok: true, outcome: out.outcome, ms: Date.now() - started });
  }

  @Get('webhooks')
  @UseGuards(SessionAuthGuard)
  list(@CurrentWorkspace() workspace: RequestSession['workspace']) {
    return this.webhooks.listWebhooks(workspace.id);
  }

  @Post('webhooks')
  @UseGuards(SessionAuthGuard)
  create(
    @Body() body: { url?: string },
    @CurrentWorkspace() workspace: RequestSession['workspace'],
  ) {
    if (!body?.url) throw new Error('body.url is required');
    return this.webhooks.createWebhook(body.url, workspace.id);
  }
}
