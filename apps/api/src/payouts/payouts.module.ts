import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PaypalModule } from '../paypal/paypal.module';
import { SafetyModule } from '../safety/safety.module';
import { PayrollService } from './payroll.service';
import { PayoutsController } from './payouts.controller';
import { PayoutsService } from './payouts.service';

@Module({
  imports: [AuthModule, PaypalModule, SafetyModule],
  controllers: [PayoutsController],
  providers: [PayoutsService, PayrollService],
  exports: [PayoutsService, PayrollService],
})
export class PayoutsModule {}
