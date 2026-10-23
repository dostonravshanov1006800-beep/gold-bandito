# Gold Bandito

Слот-мини-апп для Telegram, механика — точная копия **Wild Bandito** (PG Soft).
Бот: [@masons_agent](https://t.me/masons_agent). Gold Bot не тронут — всё живёт
в этом отдельном репозитории.

## Механика (как в оригинале)

- Сетка **5×4**, **1,024 ways** — выигрыш: 3+ одинаковых символа на барабанах
  подряд слева направо, расположение в столбце не важно
- **Tumble**: выигрышные символы сгорают, сверху падают новые, каскады продолжаются
- **Золотые рамки**: сгоревшая рамка превращается в **вайлда** (заменяет любой символ)
- **3+ гитары-скаттера → 12 фриспинов** (+2 за каждую сверх трёх),
  во фриспинах множитель **+1 за каждый каскад** и не сбрасывается до конца бонуса
- **RTP ≈ 96.7%** (у оригинала 96.73%), бонус ~1 из 116 спинов
- Макс. выигрыш — десятки тысяч × ставки (теоретически, как в оригинале)

## Архитектура

- **Фронт:** статика в `webapp/` → GitHub Pages
- **Бэк:** Cloudflare Worker (`worker/`) + D1 (SQLite в облаке, бесплатный тариф)
- **Бот:** webhook-режим (надёжнее поллинга, не спит, не рестартует)
- Результат спина считает **только сервер**; фронт лишь анимирует готовый сценарий
- Каждый запрос проверяется по подписи initData (HMAC-SHA256)

## Настройка (один раз)

### 1. Cloudflare (бесплатно, без карты)

1. Зарегистрируйся на [dash.cloudflare.com](https://dash.cloudflare.com) (Free).
2. Установи wrangler и войди:
   ```bash
   npm install -g wrangler
   wrangler login
   ```
3. Создай базу D1:
   ```bash
   wrangler d1 create gold-bandito
   ```
   Из вывода скопируй `database_id` и вставь в `worker/wrangler.toml`.
4. Создай таблицы:
   ```bash
   wrangler d1 execute gold-bandito --file worker/schema.sql --remote
   ```
5. Задай секреты (по очереди, каждый спросит значение):
   ```bash
   cd worker
   wrangler secret put BOT_TOKEN        # токен @masons_agent
   wrangler secret put ADMIN_IDS         # твой Telegram ID (админы через запятую)
   wrangler secret put WEBHOOK_SECRET    # случайная строка ~40 символов
   ```
6. Деплой:
   ```bash
   wrangler deploy
   ```
   Запомни URL: `https://gold-bandito.<поддомен>.workers.dev`

### 2. Webhook бота

```bash
curl "https://api.telegram.org/bot<ТОКЕН>/setWebhook?url=https://gold-bandito.<поддомен>.workers.dev/api/telegram&secret_token=<WEBHOOK_SECRET>"
```

Проверка: `curl https://gold-bandito.<поддомен>.workers.dev/` → `{"ok":true,...}`

### 3. Фронт

0. Включи Pages: Settings → Pages → Source: **GitHub Actions**.
1. В `webapp/config.js` укажи URL воркера:
   ```js
   window.GB_CONFIG = { apiBase: "https://gold-bandito.<поддомен>.workers.dev" };
   ```
2. Пуш в main — workflow «Deploy webapp to Pages» выложит фронт на
   `https://dostonravshanov1006800-beep.github.io/gold-bandito/`

### 4. BotFather

Открой [@BotFather](https://t.me/BotFather) → `/mybots` → @masons_agent →
Bot Settings → Menu Button → задай URL:
`https://dostonravshanov1006800-beep.github.io/gold-bandito/`

Кнопка «Играть» в боте уже встроена (keyboard web_app).

### 5. (Опционально) автодеплой воркера из GitHub

Settings → Secrets and variables → Actions:

- `CLOUDFLARE_API_TOKEN` — токен «Edit Cloudflare Workers» (Account: Workers Scripts:Edit, D1:Edit)
- `CLOUDFLARE_ACCOUNT_ID` — Account ID из дашборда

После этого каждый пуш в `worker/**` деплоит воркер автоматически.

## Проверка

```bash
cd worker
node sim.mjs            # RTP: должно быть ≈ 96.6% (база + фриспины)
node test-worker.mjs     # интеграционные тесты API (мок-D1)
```

## Админ-команды бота

- `/give <user_id> <сумма>` — пополнить голду (тесты, вручную)
- `/stats` — юзеры, спины, фактический RTP

## Экономика

- Стартовый баланс: 1000 G
- Ставки: 10 / 50 / 100 / 500 / 1000 G
- Пополнение за Stars и задания — этап 2

## Структура

```
webapp/               мини-апп (HTML/CSS/JS, статика для Pages)
worker/               Cloudflare Worker: бот + игровой API + D1
worker/src/game.js    движок слота (Wild Bandito механика)
worker/src/auth.js    проверка подписи initData (HMAC)
worker/src/db.js      запросы к D1
worker/src/bot.js     команды бота (/start /balance /help /give /stats)
worker/sim.mjs        симуляция RTP
worker/test-worker.mjs интеграционные тесты
```

## Безопасность

- Результат спина считает только сервер — из консоли не накрутить
- Подпись initData (HMAC-SHA256, срок 24 ч) + атомарное списание ставки
- Webhook защищён `secret_token`
