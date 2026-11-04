import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ContactsModule } from '../contacts/contacts.module';
import { LlmModule } from '../llm/llm.module';
import { SafetyModule } from '../safety/safety.module';
import { TelegramModule } from '../telegram/telegram.module';
import { PipelineController } from './pipeline.controller';
import { PipelineService } from './pipeline.service';

@Module({
  imports: [AuthModule, LlmModule, ContactsModule, SafetyModule, TelegramModule],
  controllers: [PipelineController],
  providers: [PipelineService],
  exports: [PipelineService],
})
export class PipelineModule {}
