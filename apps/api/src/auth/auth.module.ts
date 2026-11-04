import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { DemoService } from './demo.service';
import { GoogleAuthService } from './google-auth.service';
import { SessionService } from './session.service';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';

/**
 * Identity + tenancy. Deliberately imports no feature module (the PayPal
 * credential probe is a local fetch, not PaypalModule): any feature module
 * must be free to import AuthModule without cycling.
 */
@Module({
  controllers: [AuthController, WorkspacesController],
  providers: [GoogleAuthService, SessionService, WorkspacesService, DemoService],
  exports: [GoogleAuthService, SessionService, WorkspacesService, DemoService],
})
export class AuthModule {}
