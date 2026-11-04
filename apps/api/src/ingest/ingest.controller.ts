import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { EmailStatus, Prisma } from '@prisma/client';
import { CurrentWorkspace } from '../auth/current-workspace.decorator';
import type { RequestSession } from '../auth/session.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { PipelineService } from '../pipeline/pipeline.service';
import { PrismaService } from '../prisma/prisma.service';
import { GmailIngestService } from './gmail-ingest.service';

@Controller('ingest')
@UseGuards(SessionAuthGuard)
export class IngestController {
  constructor(
    private readonly ingest: GmailIngestService,
    private readonly prisma: PrismaService,
    private readonly pipeline: PipelineService,
  ) {}

  /**
   * Manual sync of the caller's own connected mailbox — handy for the demo
   * and for testing without waiting a tick.
   */
  @Post('run')
  async run(@CurrentWorkspace() workspace: RequestSession['workspace']) {
    const connection = await this.prisma.workspace.findUnique({
      where: { id: workspace.id },
      select: { gmailAddress: true, gmailRefreshToken: true },
    });
    if (!connection?.gmailRefreshToken) {
      throw new BadRequestException(
        'Gmail is not connected for this workspace — connect it under Settings → Gmail',
      );
    }
    return this.ingest.syncOnce({
      workspaceId: workspace.id,
      refreshToken: connection.gmailRefreshToken,
      gmailAddress: connection.gmailAddress,
    });
  }

  @Get('status')
  async status(@CurrentWorkspace() workspace: RequestSession['workspace']) {
    return this.ingest.status(workspace.id);
  }

  /**
   * Stored inbox for the dashboard Inbox tab. List rows carry a snippet, not
   * the full raw body; the detail route returns the body plus linked actions.
   */
  @Get('emails')
  async listEmails(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Query('status') status?: string,
    @Query('q') query?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    if (
      status &&
      !Object.values(EmailStatus).includes(status as EmailStatus)
    ) {
      throw new BadRequestException(
        `invalid status: ${status} (want ${Object.values(EmailStatus).join(', ')})`,
      );
    }
    const take = Math.min(Math.max(Number(limit ?? 20) || 20, 1), 100);
    const where: Prisma.EmailWhereInput = {
      workspaceId: workspace.id,
      ...(status ? { status: status as EmailStatus } : {}),
      ...(query
        ? {
            OR: [
              { from: { contains: query, mode: 'insensitive' } },
              { subject: { contains: query, mode: 'insensitive' } },
              { body: { contains: query, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.email.findMany({
      where,
      orderBy: { receivedAt: 'desc' },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        from: true,
        subject: true,
        body: true,
        status: true,
        receivedAt: true,
        createdAt: true,
        actions: {
          orderBy: { createdAt: 'asc' },
          take: 5,
          select: { id: true, type: true, status: true },
        },
      },
    });
    const page = rows.slice(0, take).map((row) => ({
      id: row.id,
      from: row.from,
      subject: row.subject,
      snippet: row.body.replace(/\s+/g, ' ').trim().slice(0, 240),
      status: row.status,
      receivedAt: row.receivedAt,
      createdAt: row.createdAt,
      actions: row.actions,
    }));
    return {
      rows: page,
      nextCursor:
        rows.length > take ? page[page.length - 1].id : null,
      totalCount: await this.prisma.email.count({ where }),
    };
  }

  @Get('emails/:id')
  async getEmail(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Param('id') id: string,
  ) {
    const email = await this.prisma.email.findFirst({
      where: { id, workspaceId: workspace.id },
      include: {
        actions: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            type: true,
            status: true,
            payeeName: true,
            amount: true,
            currency: true,
            purpose: true,
            policyVerdict: true,
            confidence: true,
            extractedJson: true,
            createdAt: true,
          },
        },
      },
    });
    if (!email) throw new NotFoundException(`email ${id} not found`);
    return email;
  }

  /**
   * Continue a NEEDS_REVIEW email from its stored extraction (no re-extract):
   * the dashboard "Retry this email" button. Runs Gate 1 fresh.
   */
  @Post('emails/:id/retry')
  async retryEmail(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Param('id') id: string,
  ) {
    return this.pipeline.retryEmail(id, workspace.id);
  }
}
