import { ConfigService } from '@nestjs/config';
import { json, urlencoded } from 'express';

/**
 * Shared HTTP-app setup: body limits and dashboard CORS. main.ts applies
 * it to the real server; HTTP gate scripts apply it to their ephemeral
 * apps so what they verify is what ships.
 */
export function configureApp(app: {
  use: (...args: unknown[]) => unknown;
  enableCors: (options: Record<string, unknown>) => unknown;
  get: (token: new (...args: never[]) => ConfigService) => ConfigService;
}): void {
  // Chat attachments arrive as base64 JSON; the default 100kb cap is too
  // small. Registered before init, so these run ahead of the default parsers.
  app.use(json({ limit: '25mb' }));
  app.use(urlencoded({ extended: true, limit: '25mb' }));
  const config = app.get(ConfigService);
  // The dashboard is a browser app on another origin: allow it (and only
  // it) with credentials so the session cookie flows. Comma-separated to
  // support dev + deployed dashboards at once.
  const webOrigins = (config.get<string>('WEB_APP_URL') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (
    webOrigins.length === 0 &&
    config.get<string>('NODE_ENV') === 'production'
  ) {
    throw new Error(
      'WEB_APP_URL is not set: dashboard CORS origin unknown in production',
    );
  }
  app.enableCors({
    origin: webOrigins.length > 0 ? webOrigins : ['http://localhost:3000'],
    credentials: true,
  });
}
