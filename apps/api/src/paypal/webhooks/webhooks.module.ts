import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../../approvals/approvals.module';
import { AuthModule } from '../../auth/auth.module';
import { ContactsModule } from '../../contacts/contacts.module';
import { TelegramModule } from '../../telegram/telegram.module';
import { PaypalModule } from '../paypal.module';
import { PaypalWebhooksController } from './webhooks.controller';
import { PaypalWebhooksService } from './webhooks.service';

/**
 * Lives under paypal/ but wires separately: PaypalModule must NOT import this
 * (ApprovalsModule already imports PaypalModule, so that direction cycles).
 */
@Module({
  imports: [
    PaypalModule,
    ApprovalsModule,
    AuthModule,
    ContactsModule,
    TelegramModule,
  ],
  controllers: [PaypalWebhooksController],
  providers: [PaypalWebhooksService],
  exports: [PaypalWebhooksService],
})
export class WebhooksModule {}
