import { Module } from '@nestjs/common';
import { LlmService } from './llm.service';
import { OpenAiCompatibleProvider } from './openai-compatible.provider';
import { VisionService } from './vision.service';

@Module({
  providers: [OpenAiCompatibleProvider, LlmService, VisionService],
  exports: [OpenAiCompatibleProvider, LlmService, VisionService],
})
export class LlmModule {}
