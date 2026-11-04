import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile, readFile, unlink } from 'node:fs/promises';

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const TRANSCODE_TIMEOUT_MS = 60_000;

/**
 * Muse Voice Transcribe speech-to-text. Telegram voice notes arrive as
 * OGG/Opus; the Meta endpoint wants WAV, so input is transcoded with ffmpeg
 * (24 kHz mono, the model's native rate) before upload.
 */
@Injectable()
export class TranscriptionService {
  constructor(private readonly config: ConfigService) {}

  async transcribe(audio: Buffer, format = 'ogg'): Promise<string> {
    if (audio.length === 0) throw new Error('empty audio');
    if (audio.length > MAX_AUDIO_BYTES) {
      throw new Error('voice note is larger than 25 MB');
    }
    const rawBase = this.config.get<string>('META_MODEL_URL') ?? '';
    const apiKey = this.config.get<string>('META_MODEL_API_KEY');
    if (!rawBase || !apiKey) {
      throw new Error('META_MODEL_URL / META_MODEL_API_KEY are not set');
    }
    const base = rawBase.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
    const model =
      this.config.get<string>('TRANSCRIBE_MODEL')?.trim() ||
      'muse-voice-transcribe-1.0';

    const wav = await this.toWav(audio, format);
    const form = new FormData();
    form.append(
      'request',
      new Blob(
        [
          JSON.stringify({
            mode: 'DIARIZATION',
            model,
            audioEncoding: 'WAV',
          }),
        ],
        { type: 'application/json' },
      ),
    );
    // Copy into a fresh Uint8Array: Buffer's ArrayBufferLike is not a BlobPart.
    form.append(
      'audio',
      new Blob([new Uint8Array(wav)], { type: 'audio/wav' }),
      'audio.wav',
    );

    const res = await fetch(
      `${base}/asr/transcribe?sessionId=${randomUUID()}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      },
    );
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`transcription HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    let json: {
      transcript?: string;
      turns?: Array<{ transcript?: string }>;
    };
    try {
      json = JSON.parse(text) as typeof json;
    } catch {
      return text.trim();
    }
    const out =
      json.transcript?.trim() ||
      (json.turns ?? [])
        .map((t) => t.transcript?.trim() ?? '')
        .filter(Boolean)
        .join(' ');
    return out;
  }

  private toWav(audio: Buffer, format: string): Promise<Buffer> {
    const ext = /^[a-z0-9]+$/i.test(format) ? format.toLowerCase() : 'ogg';
    const tag = randomUUID();
    const inputPath = join(tmpdir(), `arkpay-asr-in-${tag}.${ext}`);
    const outputPath = join(tmpdir(), `arkpay-asr-out-${tag}.wav`);
    return writeFile(inputPath, audio)
      .then(
        () =>
          new Promise<void>((resolve, reject) => {
            execFile(
              'ffmpeg',
              [
                '-y',
                '-loglevel',
                'error',
                '-i',
                inputPath,
                '-ar',
                '24000',
                '-ac',
                '1',
                '-map_metadata',
                '-1',
                outputPath,
              ],
              { timeout: TRANSCODE_TIMEOUT_MS },
              (error) => {
                if (error) {
                  reject(
                    new Error(
                      `audio transcode failed (is ffmpeg installed?): ${error.message.slice(0, 200)}`,
                    ),
                  );
                } else {
                  resolve();
                }
              },
            );
          }),
      )
      .then(() => readFile(outputPath))
      .finally(() =>
        Promise.allSettled([unlink(inputPath), unlink(outputPath)]).then(
          () => undefined,
        ),
      );
  }
}
