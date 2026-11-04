import { Controller, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectBot } from 'nestjs-telegraf';
import type { Request, Response } from 'express';
import { Telegraf } from 'telegraf';

/**
 * Telegram webhook endpoint for Render. Telegram's `setWebhook` sends the
 * configured secret in `X-Telegram-Bot-Api-Secret-Token` (verified against
 * https://core.telegram.org/bots/api#setwebhook).
 */
@Controller('telegram')
export class TelegramWebhookController {
  constructor(
    @InjectBot() private readonly bot: Telegraf,
    private readonly config: ConfigService,
  ) {}

  @Post('webhook')
  async webhook(@Req() req: Request, @Res() res: Response): Promise<void> {
    const expected = this.config.get<string>('TELEGRAM_WEBHOOK_SECRET');
    if (expected) {
      const received = req.headers['x-telegram-bot-api-secret-token'];
      if (received !== expected) {
        res.status(401).json({ ok: false });
        return;
      }
    }
    await this.bot.handleUpdate(req.body);
    res.status(200).json({ ok: true });
  }
}
