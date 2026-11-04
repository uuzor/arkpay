import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { getBotToken } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { configureApp } from './app-config';
import { AppModule } from './app.module';
import { ApprovalsService } from './approvals/approvals.service';
import { GmailPollerService } from './ingest/gmail-poller.service';
import { SchedulerService } from './scheduler/scheduler.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  app.enableShutdownHooks();
  const config = app.get(ConfigService);
  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);

  // Poller starts only in the server process, never in one-shot CLI contexts.
  app.get(GmailPollerService).start();
  // The generic scheduler owns payroll, reminders and any future schedule.
  app.get(SchedulerService).start();

  // Reconcile rows left EXECUTING by a crash before this boot (same reason:
  // server process only — CLI contexts must not touch execution state).
  await app
    .get(ApprovalsService)
    .reconcileStaleExecuting()
    .then((r) => {
      // eslint-disable-next-line no-console
      console.log(
        `Execution reconcile: ${r.reconciled} reconciled, ${r.requeued} requeued, ${r.failed} failed, ${r.skipped} skipped`,
      );
    })
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.error(
        `Execution reconcile failed: ${e instanceof Error ? e.message : e}`,
      );
    });

  const bot = app.get<Telegraf>(getBotToken());
  const telegramMode = config.get<string>('TELEGRAM_MODE') ?? 'polling';
  if (telegramMode === 'polling') {
    void bot.launch().catch((e) => {
      // eslint-disable-next-line no-console
      console.error(
        `Telegram polling failed: ${e instanceof Error ? e.message : e}`,
      );
    });
    // eslint-disable-next-line no-console
    console.log('Telegram bot polling started');
  } else if (telegramMode === 'webhook') {
    const publicUrl = (config.get<string>('API_PUBLIC_URL') ?? '').replace(
      /\/+$/,
      '',
    );
    const webhookUrl = `${publicUrl}/telegram/webhook`;
    const secret = config.get<string>('TELEGRAM_WEBHOOK_SECRET');
    if (!webhookUrl.startsWith('https://')) {
      // eslint-disable-next-line no-console
      console.warn(
        `TELEGRAM_MODE=webhook needs an HTTPS API_PUBLIC_URL; not setting ${webhookUrl}`,
      );
    } else {
      await bot.telegram.setWebhook(
        webhookUrl,
        secret ? { secret_token: secret } : undefined,
      );
      // eslint-disable-next-line no-console
      console.log(`Telegram webhook set: ${webhookUrl}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(`ArkPay API listening on :${port}`);
}
bootstrap();
