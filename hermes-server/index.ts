import { Telegraf } from 'telegraf';
import axios from 'axios';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const ALLOWED_USER_ID = parseInt(process.env.ALLOWED_TELEGRAM_USER_ID!);
const MAC_TAILSCALE_IP = process.env.MAC_TAILSCALE_IP!;
const HERMES_SECRET_TOKEN = process.env.HERMES_SECRET_TOKEN!;

if (!TELEGRAM_BOT_TOKEN || !ALLOWED_USER_ID || !MAC_TAILSCALE_IP || !HERMES_SECRET_TOKEN) {
  console.error('Missing env vars. Check .env file.');
  process.exit(1);
}

type Intent =
  | { intent: 'git_pull' }
  | { intent: 'git_push'; message: string }
  | { intent: 'git_status' }
  | { intent: 'get_errors' }
  | { intent: 'get_status' }
  | { intent: 'unknown'; rawText: string };

function parseIntent(text: string): Intent {
  const t = text.toLowerCase().trim();
  if (t.includes('pull') || t.includes('update')) return { intent: 'git_pull' };
  if (t.includes('push') || t.includes('commit')) {
    const msg = text.match(/["'](.+)["']/)?.[1] ?? 'Update from Telegram';
    return { intent: 'git_push', message: msg };
  }
  if (t.includes('status') || t.includes('gimana') || t.includes('cek')) return { intent: 'git_status' };
  if (t.includes('error') || t.includes('log') || t.includes('bug')) return { intent: 'get_errors' };
  if (t.includes('queue') || t.includes('task') || t.includes('antrian')) return { intent: 'get_status' };
  return { intent: 'unknown', rawText: text };
}

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// Whitelist middleware
bot.use((ctx, next) => {
  if (ctx.from?.id !== ALLOWED_USER_ID) {
    return ctx.reply('⛔ Unauthorized.');
  }
  return next();
});

bot.command('start', ctx => {
  ctx.reply(`🤖 Hermes aktif!\n\nPerintah tersedia:\n• pull / update\n• push "pesan commit"\n• status / cek / gimana\n• error / log\n• queue / task / antrian`);
});

bot.on('text', async ctx => {
  const intent = parseIntent(ctx.message.text);

  if (intent.intent === 'unknown') {
    return ctx.reply('❓ Perintah tidak dikenal. Coba: pull, push "message", status, errors, queue');
  }

  const displayIntent = 'intent' in intent ? intent.intent : 'unknown';
  await ctx.reply(`⏳ Mengirim perintah ke Mac: ${displayIntent}...`);

  try {
    const response = await axios.post(
      `http://${MAC_TAILSCALE_IP}:3456/command`,
      intent,
      {
        headers: { 'X-Hermes-Token': HERMES_SECRET_TOKEN, 'Content-Type': 'application/json' },
        timeout: 30_000,
      }
    );

    const data = response.data.data;
    const formatted = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    await ctx.reply(`✅ Done:\n\`\`\`\n${formatted.slice(0, 3000)}\n\`\`\``, { parse_mode: 'Markdown' });
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    if (e.code === 'ECONNREFUSED' || e.code === 'ETIMEDOUT') {
      await ctx.reply('❌ Mac tidak merespons. Pastikan VS Code terbuka dan extension aktif, dan Tailscale connected.');
    } else {
      await ctx.reply(`❌ Error: ${e.message}`);
    }
  }
});

bot.launch().then(() => console.log('🤖 Hermes bot started.'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
