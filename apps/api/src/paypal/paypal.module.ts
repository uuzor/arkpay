import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PaypalAuthService } from './paypal-auth.service';
import { PaypalBalancesService } from './paypal-balances.service';
import { PaypalBillingController } from './paypal-billing.controller';
import { PaypalDisputesService } from './paypal-disputes.service';
import { PaypalInvoicesController } from './paypal-invoices.controller';
import { PaypalInvoicesService } from './paypal-invoices.service';
import { PaypalPayoutsService } from './paypal-payouts.service';
import { PaypalSubscriptionsService } from './paypal-subscriptions.service';
import { PaypalTransactionsService } from './paypal-transactions.service';

@Module({
  imports: [AuthModule],
  controllers: [PaypalInvoicesController, PaypalBillingController],
  providers: [
    PaypalAuthService,
    PaypalInvoicesService,
    PaypalPayoutsService,
    PaypalBalancesService,
    PaypalTransactionsService,
    PaypalSubscriptionsService,
    PaypalDisputesService,
  ],
  exports: [
    PaypalAuthService,
    PaypalInvoicesService,
    PaypalPayoutsService,
    PaypalBalancesService,
    PaypalTransactionsService,
    PaypalSubscriptionsService,
    PaypalDisputesService,
  ],
})
export class PaypalModule {}
