import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PaypalAuthService } from './paypal-auth.service';
import { PaypalBalancesService } from './paypal-balances.service';
import { PaypalInvoicesController } from './paypal-invoices.controller';
import { PaypalInvoicesService } from './paypal-invoices.service';
import { PaypalPayoutsService } from './paypal-payouts.service';
import { PaypalTransactionsService } from './paypal-transactions.service';

@Module({
  imports: [AuthModule],
  controllers: [PaypalInvoicesController],
  providers: [
    PaypalAuthService,
    PaypalInvoicesService,
    PaypalPayoutsService,
    PaypalBalancesService,
    PaypalTransactionsService,
  ],
  exports: [
    PaypalAuthService,
    PaypalInvoicesService,
    PaypalPayoutsService,
    PaypalBalancesService,
    PaypalTransactionsService,
  ],
})
export class PaypalModule {}
