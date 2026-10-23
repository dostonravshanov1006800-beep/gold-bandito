// Проверка подписи initData из Telegram WebApp (HMAC-SHA256).
// Возвращает объект user при успехе, иначе null.

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

export async function validateInitData(initData, botToken, maxAgeSec = 86400) {
  if (!initData || !botToken) return null;
  const enc = new TextEncoder();
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  // data_check_string: поля по алфавиту, "k=v", через \n
  const dc = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = await crypto.subtle.importKey(
    'raw', enc.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const derivedKey = await crypto.subtle.sign('HMAC', secretKey, enc.encode(botToken));
  const verifyKey = await crypto.subtle.importKey(
    'raw', derivedKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
  );
  const ok = await crypto.subtle.verify('HMAC', verifyKey, hexToBytes(hash), enc.encode(dc));
  if (!ok) return null;

  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;

  try {
    return JSON.parse(params.get('user') || 'null');
  } catch {
    return null;
  }
}

export function isAdmin(user, adminIds) {
  if (!user || !adminIds) return false;
  const ids = String(adminIds).split(',').map(s => Number(s.trim())).filter(Boolean);
  return ids.includes(user.id);
}
