import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PayoutsModule } from '../payouts/payouts.module';
import { TelegramModule } from '../telegram/telegram.module';
import { ScheduleHandlers } from './handlers.service';
import { SchedulerController } from './scheduler.controller';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [AuthModule, PayoutsModule, TelegramModule],
  controllers: [SchedulerController],
  providers: [ScheduleHandlers, SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
