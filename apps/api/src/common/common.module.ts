import { Global, Module } from '@nestjs/common';
import { SecretBoxService } from './secret-box.service';

/** Global so any feature module can encrypt/decrypt tenant secrets. */
@Global()
@Module({
  providers: [SecretBoxService],
  exports: [SecretBoxService],
})
export class CommonModule {}
