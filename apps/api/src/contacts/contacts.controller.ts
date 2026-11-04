import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ContactKind } from '@prisma/client';
import { CurrentWorkspace } from '../auth/current-workspace.decorator';
import type { RequestSession } from '../auth/session.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { ContactsService } from './contacts.service';

interface CreateContactBody {
  name?: string;
  payeePaypal?: string;
  kind?: string;
}

interface UpdateContactBody {
  name?: string;
  payeePaypal?: string | null;
  kind?: string;
}

/** Session-guarded address book: every route is scoped to the caller's workspace. */
@Controller('contacts')
@UseGuards(SessionAuthGuard)
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  async list(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Query('kind') kind?: string,
  ) {
    const allowed = Object.values(ContactKind);
    const filter = allowed.includes(kind as ContactKind)
      ? (kind as ContactKind)
      : undefined;
    return this.contacts.list(workspace.id, filter);
  }

  /** Create (or match) a contact in the caller's workspace. */
  @Post()
  async create(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Body() body: CreateContactBody,
  ) {
    const payload = body ?? {};
    const kind = Object.values(ContactKind).includes(
      payload.kind as ContactKind,
    )
      ? (payload.kind as ContactKind)
      : undefined;
    if (payload.kind && !kind) {
      throw new BadRequestException(
        `invalid kind: ${payload.kind} (want CLIENT, SUPPLIER, or STAFF)`,
      );
    }
    return this.contacts.findOrCreate(
      {
        name: payload.name ?? '',
        paypalEmail: payload.payeePaypal,
        kind,
      },
      workspace.id,
    );
  }

  @Get(':id')
  async getOne(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Param('id') id: string,
  ) {
    try {
      return await this.contacts.getById(id, workspace.id);
    } catch {
      throw new NotFoundException(`contact ${id} not found`);
    }
  }

  /** Edit name, PayPal email or kind. */
  @Patch(':id')
  async patch(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Param('id') id: string,
    @Body() body: UpdateContactBody,
  ) {
    const payload = body ?? {};
    const kind = Object.values(ContactKind).includes(
      payload.kind as ContactKind,
    )
      ? (payload.kind as ContactKind)
      : undefined;
    if (payload.kind && !kind) {
      throw new BadRequestException(
        `invalid kind: ${payload.kind} (want CLIENT, SUPPLIER, or STAFF)`,
      );
    }
    try {
      return await this.contacts.update(
        id,
        {
          ...(payload.name !== undefined ? { name: payload.name } : {}),
          ...(payload.payeePaypal !== undefined
            ? { paypalEmail: payload.payeePaypal }
            : {}),
          ...(kind ? { kind } : {}),
        },
        workspace.id,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes('not found')) {
        throw new NotFoundException(message);
      }
      throw new BadRequestException(message);
    }
  }
}
