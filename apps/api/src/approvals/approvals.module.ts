import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ContactsModule } from '../contacts/contacts.module';
import { PaypalModule } from '../paypal/paypal.module';
import { SafetyModule } from '../safety/safety.module';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';
import { DecisionService } from './decision.service';

@Module({
  imports: [AuthModule, ContactsModule, PaypalModule, SafetyModule],
  controllers: [ApprovalsController],
  providers: [ApprovalsService, DecisionService],
  exports: [ApprovalsService, DecisionService],
})
export class ApprovalsModule {}
