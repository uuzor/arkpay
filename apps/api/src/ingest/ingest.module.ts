import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/approvals.module';
import { AuthModule } from '../auth/auth.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { TelegramModule } from '../telegram/telegram.module';
import { GmailAuthService } from './gmail-auth.service';
import { GmailClientService } from './gmail-client.service';
import { GmailIngestService } from './gmail-ingest.service';
import { GmailPollerService } from './gmail-poller.service';
import { IngestController } from './ingest.controller';

@Module({
  imports: [ApprovalsModule, AuthModule, PipelineModule, TelegramModule],
  controllers: [IngestController],
  providers: [
    GmailAuthService,
    GmailClientService,
    GmailIngestService,
    GmailPollerService,
  ],
  exports: [GmailIngestService, GmailPollerService],
})
export class IngestModule {}
