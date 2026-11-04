import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegrafModule } from 'nestjs-telegraf';
import { AgentChatController } from '../agent/agent-chat.controller';
import { AgentService } from '../agent/agent.service';
import { ApprovalsModule } from '../approvals/approvals.module';
import { AuthModule } from '../auth/auth.module';
import { ContactsModule } from '../contacts/contacts.module';
import { LlmModule } from '../llm/llm.module';
import { PaypalModule } from '../paypal/paypal.module';
import { PayoutsModule } from '../payouts/payouts.module';
import { SafetyModule } from '../safety/safety.module';
import { CreationController } from './creation.controller';
import { DraftService } from './drafts.service';
import { InvoiceFollowupService } from './invoice-followup.service';
import { PayrollController } from './payroll.controller';
import { StatementService } from './statement.service';
import { TelegramDemoController } from './telegram-demo.controller';
import { TelegramTeamController } from './telegram-team.controller';
import { TelegramService } from './telegram.service';
import { TelegramUpdate } from './telegram.update';
import { TelegramWebhookController } from './telegram-webhook.controller';
import { TranscriptionService } from './transcription.service';

@Module({
  imports: [
    AuthModule,
    ContactsModule,
    ApprovalsModule,
    PayoutsModule,
    LlmModule,
    PaypalModule,
    SafetyModule,
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const token = config.get<string>('TELEGRAM_BOT_TOKEN');
        if (!token) {
          throw new Error('TELEGRAM_BOT_TOKEN is not set');
        }
        // Never auto-launch: main.ts starts polling (local) or sets the
        // webhook (Render), so one-shot CLI contexts don't start a second bot.
        return { token, launchOptions: false };
      },
    }),
  ],
  controllers: [
    AgentChatController,
    CreationController,
    TelegramDemoController,
    TelegramTeamController,
    TelegramWebhookController,
    PayrollController,
  ],
  providers: [
    TelegramService,
    TelegramUpdate,
    AgentService,
    DraftService,
    StatementService,
    TranscriptionService,
    InvoiceFollowupService,
  ],
  exports: [TelegramService, AgentService, InvoiceFollowupService],
})
export class TelegramModule {}
