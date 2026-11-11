import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ApprovalsModule } from './approvals/approvals.module';
import { CommonModule } from './common/common.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { ContactsModule } from './contacts/contacts.module';
import { HealthController } from './health.controller';
import { IngestModule } from './ingest/ingest.module';
import { LlmModule } from './llm/llm.module';
import { OverviewModule } from './overview/overview.module';
import { PaypalModule } from './paypal/paypal.module';
import { WebhooksModule } from './paypal/webhooks/webhooks.module';
import { PayoutsModule } from './payouts/payouts.module';
import { PipelineModule } from './pipeline/pipeline.module';
import { PrismaModule } from './prisma/prisma.module';
import { SafetyModule } from './safety/safety.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { TelegramModule } from './telegram/telegram.module';

@Module({
  imports: [
    // Single .env at repo root (../../.env when run from apps/api),
    // plus a local apps/api/.env if present.
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    CommonModule,
    PrismaModule,
    AuthModule,
    AuditModule,
    SafetyModule,
    SchedulerModule,
    PaypalModule,
    WebhooksModule,
    ApprovalsModule,
    PayoutsModule,
    PipelineModule,
    IngestModule,
    LlmModule,
    ContactsModule,
    TelegramModule,
    OverviewModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
