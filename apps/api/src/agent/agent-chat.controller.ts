import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { PDFParse } from 'pdf-parse';
import { CurrentWorkspace } from '../auth/current-workspace.decorator';
import type { RequestSession } from '../auth/session.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { VisionService } from '../llm/vision.service';
import { PrismaService } from '../prisma/prisma.service';
import { TranscriptionService } from '../telegram/transcription.service';
import { AgentService, type AgentStreamEvent } from './agent.service';

const MAX_FILES = 5;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENT_CHARS = 20_000;
const STREAM_TIMEOUT_MS = 120_000;

const VISION_PROMPT =
  'Describe everything visible in this image in plain text. If it is a receipt, invoice, bill or payment screenshot, transcribe the merchant/payee name, every amount with its currency, the date, and any reference numbers — exactly as shown, no guessing. If it is not a financial document, describe what it is in two sentences.';

interface ChatAttachmentJson {
  filename?: string;
  mimeType?: string;
  /** Base64-encoded file bytes (JSON requests). */
  contentBase64?: string;
}

interface ChatBody {
  message?: string;
  userId?: string | number;
  /** Dashboard context (open tab/row) appended to the system prompt. */
  context?: string;
  /** Boolean over JSON, the string 'true' over multipart. */
  readOnly?: boolean | string;
  attachments?: ChatAttachmentJson[];
}

interface NormalizedUpload {
  name: string;
  mime: string;
  buffer: Buffer;
}

/** Multer file shape, structurally typed to avoid adding @types/multer. */
interface MulterFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

/**
 * Dashboard AI bar surface. Same tool-using agent as Telegram — shared
 * AgentMessage memory, same tools, same Gate-1 safety path — over SSE.
 *
 * POST /agent/chat accepts JSON ({message, attachments[] with base64}) or
 * multipart/form-data (message field + files[]). Events: text-delta,
 * tool-call, tool-result, draft, document, done, error (exactly one of the
 * last two per request).
 */
@Controller('agent')
@UseGuards(SessionAuthGuard)
export class AgentChatController {
  constructor(
    private readonly agent: AgentService,
    private readonly prisma: PrismaService,
    private readonly vision: VisionService,
    private readonly transcription: TranscriptionService,
  ) {}

  /**
   * Chat-thread identity: explicit numeric userId, else the workspace's
   * linked Telegram id — the default keeps a workspace's Telegram and
   * dashboard turns in one shared thread.
   */
  private async resolveUserId(
    raw: unknown,
    workspaceId: string,
  ): Promise<number> {
    const link =
      raw === undefined || raw === null
        ? await this.prisma.telegramLink.findUnique({
            where: { workspaceId },
            select: { telegramId: true },
          })
        : null;
    const value = raw ?? link?.telegramId;
    const id =
      typeof value === 'number' ? value : Number(String(value ?? '').trim());
    if (!Number.isFinite(id)) {
      throw new BadRequestException(
        'numeric userId is required (or link Telegram: /link <code>)',
      );
    }
    return id;
  }

  @Post('chat')
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES, {
      limits: { fileSize: MAX_FILE_BYTES },
    }),
  )
  async chat(
    @Body() body: ChatBody,
    @UploadedFiles() files: MulterFile[] | undefined,
    @Req() req: Request,
    @Res() res: Response,
    @CurrentWorkspace() workspace: RequestSession['workspace'],
  ): Promise<void> {
    const payload = body ?? {};
    const userId = await this.resolveUserId(payload.userId, workspace.id);
    const message = typeof payload.message === 'string' ? payload.message : '';
    const uploads = this.normalizeUploads(payload.attachments, files);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (event: AgentStreamEvent): void => {
      if (res.writableEnded || res.destroyed) return;
      try {
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      } catch {
        // Client is gone; the abort below stops the run.
      }
    };
    const finish = (): void => {
      if (!res.writableEnded) res.end();
    };

    const aborter = new AbortController();
    const timeout = setTimeout(() => aborter.abort(), STREAM_TIMEOUT_MS);
    req.on('close', () => {
      clearTimeout(timeout);
      aborter.abort();
    });
    try {
      // Attachment ingest mirrors telegram.update.ts: same file kinds, same
      // prompts, same scanned-PDF and unsupported-kind nudges.
      const parts: string[] = [];
      if (message.trim()) parts.push(message.trim());
      for (const upload of uploads) {
        const ingested = await this.ingestUpload(upload);
        if (ingested.kind === 'nudge') {
          send({ type: 'text-delta', text: ingested.text });
          send({ type: 'done', finishReason: 'stop', usage: null });
          return;
        }
        parts.push(ingested.prompt);
      }
      await this.agent.runStream(
        userId,
        parts.join('\n\n'),
        (event) => send(event),
        {
          // Multipart fields arrive as strings; JSON sends a real boolean.
          readOnly: payload.readOnly === true || payload.readOnly === 'true',
          origin: 'agent-chat',
          workspaceId: workspace.id,
          systemExtra:
            typeof payload.context === 'string' ? payload.context : undefined,
          signal: aborter.signal,
        },
      );
    } catch (e) {
      send({
        type: 'error',
        message: `Chat failed: ${e instanceof Error ? e.message : String(e)}`.slice(
          0,
          300,
        ),
        aborted: false,
      });
    } finally {
      clearTimeout(timeout);
      finish();
    }
  }

  /** History replay for reconnects: persisted user/assistant turns only. */
  @Get('messages')
  async messages(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Query('userId') userIdRaw?: string,
    @Query('since') since?: string,
    @Query('limit') limit?: string,
  ) {
    const userId = await this.resolveUserId(userIdRaw, workspace.id);
    if (since !== undefined && Number.isNaN(Date.parse(since))) {
      throw new BadRequestException(`invalid since: ${since}`);
    }
    const take = Math.min(Math.max(Number(limit ?? 50) || 50, 1), 200);
    const rows = await this.prisma.agentMessage.findMany({
      where: {
        userId: String(userId),
        workspaceId: workspace.id,
        ...(since ? { createdAt: { gt: new Date(since) } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take,
    });
    return {
      userId: String(userId),
      messages: rows.map((row) => ({
        id: row.id,
        role: row.role,
        content: row.content,
        createdAt: row.createdAt,
      })),
    };
  }

  private normalizeUploads(
    jsonAttachments: ChatAttachmentJson[] | undefined,
    files: MulterFile[] | undefined,
  ): NormalizedUpload[] {
    const uploads: NormalizedUpload[] = (files ?? []).map((file) => ({
      name: file.originalname || 'file',
      mime: file.mimetype || '',
      buffer: file.buffer ?? Buffer.alloc(0),
    }));
    for (const attachment of jsonAttachments ?? []) {
      if (!attachment?.contentBase64) {
        throw new BadRequestException('attachment contentBase64 is required');
      }
      let buffer: Buffer;
      try {
        buffer = Buffer.from(attachment.contentBase64, 'base64');
      } catch {
        throw new BadRequestException('attachment contentBase64 is not valid base64');
      }
      if (buffer.length === 0 || buffer.length > MAX_FILE_BYTES) {
        throw new BadRequestException(
          `attachment ${attachment.filename ?? 'file'} must be 1 byte–20 MB`,
        );
      }
      uploads.push({
        name: attachment.filename || 'file',
        mime: attachment.mimeType || '',
        buffer,
      });
    }
    if (uploads.length > MAX_FILES) {
      throw new BadRequestException(`at most ${MAX_FILES} files per message`);
    }
    return uploads;
  }

  private async ingestUpload(
    upload: NormalizedUpload,
  ): Promise<
    | { kind: 'text'; prompt: string }
    | { kind: 'nudge'; text: string }
  > {
    const { name, mime, buffer } = upload;
    if (buffer.length === 0) throw new Error(`empty file: ${name}`);
    const isPdf = mime === 'application/pdf' || /\.pdf$/i.test(name);
    const isText =
      mime.startsWith('text/') ||
      mime === 'application/json' ||
      /\.(txt|csv|md|json)$/i.test(name);
    const isAudio =
      mime.startsWith('audio/') || /\.(mp3|m4a|wav|webm|ogg|oga)$/i.test(name);
    const isImage =
      mime.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(name);

    let text = '';
    if (isPdf) {
      const parser = new PDFParse({ data: buffer });
      try {
        text = (await parser.getText()).text;
      } finally {
        await parser.destroy().catch(() => undefined);
      }
    } else if (isText) {
      text = buffer.toString('utf8');
    } else if (isAudio) {
      const format = mime.includes('mpeg')
        ? 'mp3'
        : mime.includes('m4a')
          ? 'm4a'
          : mime.includes('wav')
            ? 'wav'
            : mime.includes('webm')
              ? 'webm'
              : 'ogg';
      text = await this.transcription.transcribe(buffer, format);
      if (!text.trim()) {
        return {
          kind: 'nudge',
          text: 'I couldn’t hear any speech in that audio.',
        };
      }
    } else if (isImage) {
      text = await this.vision.describeImage(
        buffer,
        mime.startsWith('image/') ? mime : 'image/jpeg',
        VISION_PROMPT,
      );
    } else {
      return {
        kind: 'nudge',
        text: 'I can read PDF, text, CSV, JSON, audio and image files right now. Video analysis is next.',
      };
    }
    if (isPdf && text.replace(/\s+/g, '').length < 50) {
      return {
        kind: 'nudge',
        text: 'That PDF looks scanned (no readable text inside). Send me photos of the pages and I’ll read them.',
      };
    }
    const prompt = isImage
      ? `I uploaded a photo named ${name}. Here is what it shows:\n\n${text.slice(0, MAX_ATTACHMENT_CHARS)}\n\nAnalyze it. If it is a bill, receipt or money request, extract payee/amount/purpose and use create_invoice_draft or request_payout. Otherwise summarize what it is.`
      : `I uploaded a document named ${name}. Here is its text:\n\n${text.slice(0, MAX_ATTACHMENT_CHARS)}\n\nAnalyze it. If it is a money request, use create_invoice_draft. Otherwise summarize what it is.`;
    return { kind: 'text', prompt };
  }
}
