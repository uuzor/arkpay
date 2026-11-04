#!/usr/bin/env node
/**
 * Telegram voice/audio UX gate: the "Transcribing…" status is deleted before
 * the answer lands, and the transcript is never echoed back as its own
 * message — the agent answer follows the deleted status directly.
 *
 * Boots the real app and drives TelegramUpdate with a stubbed context
 * (no Telegram, no Meta, no PayPal calls).
 *
 * Run: pnpm --filter @arkpay/api test:telegram-voice
 */
const assert = require('node:assert/strict');

const TRANSCRIPT = 'pay Daniel Eze $780 for the paper supply';
const AGENT_ANSWER = 'Drafted a $780 payout to Daniel Eze.';

function makeCtx(message) {
  const calls = [];
  let nextId = 100;
  return {
    calls,
    ctx: {
      message,
      from: { id: 42 },
      reply: async (text) => {
        const id = nextId++;
        calls.push({ op: 'reply', id, text });
        return { message_id: id };
      },
      deleteMessage: async (id) => {
        calls.push({ op: 'delete', id });
        return true;
      },
    },
  };
}

async function main() {
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require('../apps/api/dist/app.module');
  const {
    TelegramUpdate,
  } = require('../apps/api/dist/telegram/telegram.update');

  const app = await NestFactory.create(AppModule, { logger: false });
  try {
    const update = app.get(TelegramUpdate);
    // Stub the network edges; the handler flow stays real.
    update.downloadFile = async () => Buffer.from('fake-audio');
    update.transcription.transcribe = async () => TRANSCRIPT;
    update.agent.run = async () => ({ text: AGENT_ANSWER });
    update.workspaces.resolveForTelegram = async () => 'owner';

    for (const [name, message] of [
      ['voice', { voice: { file_id: 'voice-1' } }],
      ['audio', { audio: { file_id: 'audio-1', mime_type: 'audio/mpeg' } }],
    ]) {
      const { calls, ctx } = makeCtx(message);
      await update[name === 'voice' ? 'onVoice' : 'onAudio'](ctx);
      const replies = calls.filter((c) => c.op === 'reply');
      const deletes = calls.filter((c) => c.op === 'delete');
      assert.equal(
        replies[0]?.text,
        '🎤 Transcribing…',
        `${name}: first message must be the Transcribing status`,
      );
      assert.equal(
        deletes.length,
        1,
        `${name}: status message must be deleted exactly once`,
      );
      assert.equal(
        deletes[0].id,
        replies[0].id,
        `${name}: deleted id must be the status message`,
      );
      assert.ok(
        !replies.some((r) => r.text.includes(TRANSCRIPT)),
        `${name}: transcript must not be echoed back`,
      );
      assert.equal(
        calls[calls.length - 1].op,
        'reply',
        `${name}: last call must be the agent answer`,
      );
      assert.match(
        calls[calls.length - 1].text,
        /Drafted a \$780 payout/,
        `${name}: answer must follow the deleted status`,
      );
      // Delete must precede the answer.
      const delIdx = calls.findIndex((c) => c.op === 'delete');
      const ansIdx = calls.findIndex(
        (c) => c.op === 'reply' && /Drafted a \$780/.test(c.text),
      );
      assert.ok(
        delIdx >= 0 && ansIdx > delIdx,
        `${name}: delete must come before the answer`,
      );
      console.log(`[PASS] ${name}: status deleted, no echo, answer follows`);
    }

    // Failure path: transcribe throws → status still deleted, error shown.
    update.transcription.transcribe = async () => {
      throw new Error('asr down');
    };
    {
      const { calls, ctx } = makeCtx({ voice: { file_id: 'voice-2' } });
      await update.onVoice(ctx);
      const deletes = calls.filter((c) => c.op === 'delete');
      assert.equal(deletes.length, 1, 'failure: status must still be deleted');
      assert.match(
        calls[calls.length - 1].text,
        /transcription failed/i,
        'failure: error reply must follow the deleted status',
      );
      console.log('[PASS] voice failure: status deleted, error shown');
    }

    console.log('Telegram voice gate: ALL GREEN');
  } finally {
    await app.close().catch(() => undefined);
  }
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exit(1);
});
