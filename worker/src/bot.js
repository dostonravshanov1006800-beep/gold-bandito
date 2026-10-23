// Telegram-бот @masons_agent (webhook-режим).
// Команды: /start /balance /help, админам: /give /stats

import { ensureUser, getBalance, adminGive, topup, stats } from './db.js';

const API = 'https://api.telegram.org/bot';

async function tg(env, method, payload) {
  return fetch(API + env.BOT_TOKEN + '/' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function mainKeyboard(webappUrl) {
  return {
    resize_keyboard: true,
    keyboard: [[{ text: 'Играть', web_app: { url: webappUrl } }]],
  };
}

const HELP = [
  'Gold Bandito — слот в стиле мексиканской ночи.',
  '',
  'Как играть: нажми «Играть» под этим сообщением — откроется мини-апп со слотом.',
  '',
  'Правила (как в оригинале):',
  '• Сетка 5×4, 1,024 ways — одинаковые символы на барабанах подряд СЛЕВА (от 3-х).',
  '• Выигрышные символы сгорают, сверху падают новые — каскады (tumble).',
  '• Символы в золотой рамке при сгорании превращаются в ВАЙЛДА (заменяют любой символ).',
  '• 3+ гитары на сетке → 12 фриспинов (+2 за каждую сверх трёх).',
  '• Во фриспинах каждый каскад поднимает множитель на +1, он не сбрасывается весь бонус.',
  '',
  'Отдача (RTP) ≈ 96.7%, как у оригинала.',
  '',
  '/balance — баланс голды',
  '/help — это сообщение',
].join('\n');

export async function handleUpdate(env, update) {
  // Пополнение Stars: pre-checkout и успешная оплата
  if (update.pre_checkout_query) {
    await tg(env, 'answerPreCheckoutQuery', {
      pre_checkout_query_id: update.pre_checkout_query.id, ok: true,
    });
    return { ok: true };
  }
  const pay = update.message && update.message.successful_payment;
  if (pay) {
    const from = update.message.from || {};
    const m = String(pay.invoice_payload || '').match(/^topup:(\d+):(\d+)$/);
    const chargeId = pay.telegram_payment_charge_id;
    if (m && chargeId && Number(pay.total_amount) === Number(m[2])) {
      try {
        const bal = await topup(env, from.id, Number(m[1]), Number(m[2]), chargeId);
        await tg(env, 'sendMessage', {
          chat_id: update.message.chat.id,
          text: `Начислено ${m[1]} G (баланс: ${bal} G). Спасибо за пополнение!`,
        });
      } catch (e) {
        // повторная доставка webhook — уже начислено, отвечаем ok чтобы Telegram не ретраил
      }
    }
    return { ok: true };
  }

  const msg = update.message || update.edited_message;
  if (!msg || !msg.text) return { ok: true };

  const chatId = msg.chat.id;
  const from = msg.from || {};
  const text = msg.text.trim();
  const adminIds = String(env.ADMIN_IDS || '').split(',').map(s => Number(s.trim())).filter(Boolean);
  const isAdmin = adminIds.includes(from.id);

  if (text.startsWith('/start')) {
    await ensureUser(env, from.id, from.username);
    await tg(env, 'sendMessage', {
      chat_id: chatId,
      text: [
        'Салют! Это Gold Bandito — салунный слот в духе мексиканской ночи.',
        '',
        'Стартовый баланс: 1000 G. Крути барабан кнопкой ниже.',
        'Сетка 5×4, 1,024 ways, каскады, вайлды из золотых рамок и фриспины с растущим множителем.',
      ].join('\n'),
      reply_markup: mainKeyboard(env.WEBAPP_URL),
    });
    return { ok: true };
  }

  if (text.startsWith('/balance')) {
    const row = await ensureUser(env, from.id, from.username);
    const lines = [`Баланс: ${row.balance} G`];
    if (row.fs_remaining > 0) {
      lines.push(`Бонус: ${row.fs_remaining} фриспинов, множитель ×${row.fs_multiplier}`);
    }
    await tg(env, 'sendMessage', { chat_id: chatId, text: lines.join('\n') });
    return { ok: true };
  }

  if (text.startsWith('/help')) {
    await tg(env, 'sendMessage', { chat_id: chatId, text: HELP });
    return { ok: true };
  }

  if (text.startsWith('/give') && isAdmin) {
    const parts = text.split(/\s+/);
    const targetId = Number(parts[1]);
    const amount = Number(parts[2]);
    if (!targetId || !amount || amount <= 0) {
      await tg(env, 'sendMessage', { chat_id: chatId, text: 'Формат: /give <user_id> <сумма>' });
      return { ok: true };
    }
    const bal = await adminGive(env, targetId, amount, from.id);
    await tg(env, 'sendMessage', {
      chat_id: chatId,
      text: `Начислено ${amount} G юзеру ${targetId}. Его баланс: ${bal} G`,
    });
    return { ok: true };
  }

  if (text.startsWith('/stats') && isAdmin) {
    const s = await stats(env);
    await tg(env, 'sendMessage', {
      chat_id: chatId,
      text: [
        'Статистика Gold Bandito:',
        `Юзеров: ${s.users}`,
        `Спинов: ${s.spins}`,
        `Поставлено: ${s.staked} G`,
        `Выплачено: ${s.won} G`,
        `Фактическая отдача (RTP): ${(s.staked > 0 ? s.won / s.staked * 100 : 0).toFixed(1)}%`,
      ].join('\n'),
    });
    return { ok: true };
  }

  if (text.startsWith('/give') || text.startsWith('/stats')) {
    await tg(env, 'sendMessage', { chat_id: chatId, text: 'Только для админов.' });
  }
  return { ok: true };
}
