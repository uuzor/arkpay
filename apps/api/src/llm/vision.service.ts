import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Same reasoning-model headroom as the extraction provider: Spark thinks
// before describing, so a small cap returns finish_reason=length + null.
const MAX_TOKENS = 4000;
const REQUEST_TIMEOUT_MS = 90_000;
// Data URLs inflate ~33%; past this the request gets slow and pricey.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Image understanding for photographed receipts, invoices, and screenshots.
 * Sends the image to a vision-capable chat model on the same OpenAI-compatible
 * endpoint and returns a plain-text description. Requires VISION_MODEL_NAME —
 * text-only models cannot do this, so a missing variable fails loudly with
 * setup instructions instead of a cryptic provider error.
 */
@Injectable()
export class VisionService {
  private readonly logger = new Logger(VisionService.name);

  constructor(private readonly config: ConfigService) {}

  private endpoint(): { url: string; apiKey: string; model: string } {
    const base = (this.config.get<string>('META_MODEL_URL') ?? '').replace(
      /\/+$/,
      '',
    );
    const apiKey = this.config.get<string>('META_MODEL_API_KEY');
    const model = this.config.get<string>('VISION_MODEL_NAME')?.trim();
    if (!base || !apiKey) {
      throw new Error('META_MODEL_URL / META_MODEL_API_KEY are not set');
    }
    if (!model) {
      throw new Error(
        'VISION_MODEL_NAME is not set — add a vision-capable model id to .env (see .env.example)',
      );
    }
    const url = base.endsWith('/chat/completions')
      ? base
      : `${base}/chat/completions`;
    return { url, apiKey, model };
  }

  async describeImage(
    buffer: Buffer,
    mimeType: string,
    instruction: string,
  ): Promise<string> {
    if (buffer.length > MAX_IMAGE_BYTES) {
      throw new Error(
        `image is ${(buffer.length / 1024 / 1024).toFixed(1)} MB; send one under 5 MB`,
      );
    }
    const mime = /^image\/(png|jpe?g|webp|gif)$/i.test(mimeType.trim())
      ? mimeType.trim().toLowerCase()
      : 'image/jpeg';
    const { url, apiKey, model } = this.endpoint();
    const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: MAX_TOKENS,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: instruction },
                { type: 'image_url', image_url: { url: dataUrl } },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      throw new Error(
        `vision request failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `vision model HTTP ${res.status}: ${text.slice(0, 300)}`,
      );
    }
    const json = JSON.parse(text) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    const out =
      typeof content === 'string'
        ? content.trim()
        : Array.isArray(content)
          ? content
              .map((p) => (typeof p === 'string' ? p : String(p?.text ?? '')))
              .join('')
              .trim()
          : '';
    if (!out) throw new Error('vision model returned an empty description');
    this.logger.debug(`vision via ${model} in ${Date.now() - started}ms`);
    return out;
  }
}
