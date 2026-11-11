import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { OverviewController } from './overview.controller';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [OverviewController],
})
export class OverviewModule {}
