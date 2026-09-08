<div align="center">

# ⚡ DIKZZAPI

**API documentation portal + live playground running on Cloudflare Workers.**

Satu Worker, puluhan endpoint — AI, tools, stalker, temp-mail, bypass, dan lainnya —
lengkap dengan halaman dokumentasi & playground interaktif.

[![Live](https://img.shields.io/badge/live-api.makluxnxx.my.id-2ea44f?style=for-the-badge&logo=cloudflare&logoColor=white)](https://api.makluxnxx.my.id)
[![Platform](https://img.shields.io/badge/Cloudflare-Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Runtime](https://img.shields.io/badge/Node-JS-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Storage](https://img.shields.io/badge/D1-SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://developers.cloudflare.com/d1/)

**🌐 Live:** [api.makluxnxx.my.id](https://api.makluxnxx.my.id) &nbsp;·&nbsp;
**👤 Author:** DikZz Xynzz &nbsp;·&nbsp;
**💬 Contact:** [WhatsApp](https://wa.me/6285757411154) · [Telegram](https://t.me/maklohytam)

</div>

---

## 📑 Daftar Isi

<table>
<tr>
<td valign="top">

**Mulai**
- [Layout proyek](#-layout)
- [Menambah endpoint](#-adding-an-endpoint)
- [Perintah npm](#-commands)
- [Meta routes](#-meta-routes)
- [Format response](#-response-format)

</td>
<td valign="top">

**AI & Image**
- [AI (Dola / Llama / Mistral)](#-ai)
- [Rewind AI](#-rewind-ai)
- [Text to image](#-text-to-image)

</td>
<td valign="top">

**Tools & Data**
- [Stalker](#-stalker)
- [Search](#-search)
- [Crypto tools](#-crypto-tools)
- [Temp mail](#-temp-mail)
- [Bypass](#-bypass)
- [Screenshot Web](#-screenshot-web)
- [Random Cecan](#-random-cecan)

</td>
<td valign="top">

**Integrasi**
- [WhatsApp React](#-whatsapp-react)
- [Detect OTP WhatsApp](#-detect-otp-whatsapp)
- [Ngl Spam](#-ngl-spam)
- [Userbot Telegram](#-userbot-telegram-ubot-login)
- [Telegram bot](#-telegram-bot)
- [Nonecap key pool](#-nonecap-key-pool)
- [Stats](#-stats)

</td>
</tr>
</table>

---

## 🧭 Sekilas endpoint

| Kategori | Endpoint utama | Ringkasan |
| --- | --- | --- |
| 🤖 **AI** | `/v1/ai/dola` · `/v1/ai/llama` · `/v1/ai/mistral` · `/v1/ai/chat` | Chat & translate — Workers AI + Rewind AI |
| 🎨 **Image** | `/v1/image/text2img` | Prompt → gambar, dibalas langsung sebagai `image` |
| 🔎 **Search** | `/v1/search/{ytplay,youtube,pinterest}` | Cari audio, video, dan gambar |
| 🕵️ **Stalker** | `/v1/stalk/{roblox,epepid,github,tiktok,instagram}` | Profil publik dalam envelope snake_case |
| 🧰 **Tools** | `/v1/tools/{encrypt-*,ssweb,ngl-spam,alightmotion,…}` | Packer, screenshot, aktivasi, dan utilitas lain |
| 📬 **Temp mail** | `/v1/tools/{emailqu,mailedu}` | Inbox sementara + ekstraksi OTP otomatis |
| 🛡️ **Bypass** | `/v1/bypass/{turnstile-min,sfl}` | Solve Turnstile & resolve short-link |
| 💬 **WhatsApp** | `/v1/tools/{whatsapp-react,detect-otp-whatsapp}` | React channel + cek cooldown OTP |
| ✈️ **Telegram** | `/v1/tools/ubot-login` · `POST /api/telegram` | Userbot GramJS + management bot |

> Katalog lengkap yang dirender halaman docs ada di `GET /api/catalog`.

---

## 📂 Layout

```
.  (root proyek)
├─ wrangler.toml            Worker config (custom domain, D1, AI, assets)
├─ schema.sql               D1 tables: endpoint_stats, recent_requests, daily_stats,
│                           rewind_keys, nonecap_keys
├─ src
│  ├─ index.js              Router: meta routes → /v1/* dispatch → static assets
│  ├─ lib
│  │  ├─ registry.js        Collects endpoint definitions, builds the UI catalog
│  │  ├─ respond.js         ok() / fail() / raw() response envelope + brand data
│  │  ├─ params.js          Query + body param collection and validation
│  │  ├─ stats.js           Rolling 24 h window, monthly ledger, activity feed
│  │  ├─ alight.js          Upstream client for the Alight Motion service
│  │  ├─ asitha.js          WhatsApp channel react client (captcha + signed session)
│  │  ├─ mailparse.js       OTP + verification-link extraction, shared by all mail
│  │  ├─ emailqu.js         Temp-mail transport (@bahlil.codes)
│  │  ├─ getedumail.js      Temp .edu mail transport (claim → poll)
│  │  ├─ ikyy.js            Shared upstream client, re-wraps every foreign body
│  │  ├─ keypool.js         Self-pruning D1 key pool (LRU pick, auto-delete)
│  │  ├─ nonecap.js         Captcha solver, rotates the key pool per request
│  │  ├─ ngl.js             NGL relay client (validate + send)
│  │  ├─ rewind.js          Rewind AI client (chat + image), D1 key pool
│  │  ├─ rewindsignup.js    Headless rewind account provisioner (/createrewind)
│  │  ├─ telegram.js        Owner-only management bot (rewind + nonecap key pools)
│  │  └─ http.js            fetch with timeout, query-string helper
│  └─ apis
│     ├─ index.js           One import line per endpoint
│     ├─ ai/                llama, mistral, dola, translate, chat (rewind)
│     ├─ bypass/            turnstile-min, sfl
│     ├─ image/             text2img
│     ├─ info/              weather, ip, currency, link-preview
│     ├─ random/            cecan-{china,indonesia,japan,korea,malaysia,
│     │                     thailand,hijaber} + shared builder _cecan.js
│     ├─ search/            ytplay, ytplayv2, ytplayv3, youtube, pinterest
│     ├─ stalk/             roblox, epepid, github, tiktok, instagram
│     └─ tools/             alightmotion, ngl-spam, emailqu, mailedu, hash,
│                           base64, qrcode, uuid, password, ping, ssweb,
│                           encrypt-{python,js,base64}, decrypt
├─ public
│  ├─ index.html            Dashboard
│  ├─ docs.html             Documentation + playground
│  ├─ information.html      Developer info & contacts
│  └─ assets/{css,js}
└─ scripts
   ├─ new-api.mjs           Endpoint scaffolder
   └─ test-keypool.mjs      Key-pool tests (npm run test:pool)
```

## 🧩 Adding an endpoint

```bash
npm run new -- --name "Gemini AI" --category AI --slug gemini \
               --path /v1/ai/gemini --desc "Gemini chat by Google" \
               --params text,sessionId
```

That creates `src/apis/ai/gemini.js` and registers it in `src/apis/index.js`.
Fill in the `handler`, then `npm run deploy`. The docs page, the search index,
the category chips, and the stats table all pick it up automatically — nothing
else to edit.

An endpoint file is just an object:

```js
import { ok, fail } from '../../lib/respond.js';

export default {
  name: 'Gemini AI',
  desc: 'Gemini chat by Google',
  category: 'AI',
  path: '/v1/ai/gemini',
  method: 'GET',
  params: [{ name: 'text', required: true, placeholder: 'Enter text' }],

  async handler({ params, env, request, ctx }) {
    return ok({ answer: '...' });      // or fail('message', 400)
  },
};
```

Return `raw(body, contentType)` for binary payloads and set
`responseType: 'image'` so the playground previews it.

## 🎨 Text to image

`/v1/image/text2img` answers with the image itself — no JSON wrapper, no base64
to decode, so it drops straight into an `<img src>` or a bot's photo upload:

```
GET /v1/image/text2img?prompt=buatin gambar naruto
```

Prompts may be Indonesian or English and are capped at 1000 characters. Generation
is a real round-trip upstream (measured 7–12 s), so the timeout is raised to 90 s
— the shared 15 s default would report a failure on a request that was still
working. The content type is taken from the upstream response rather than assumed,
and a non-image reply is turned into a normal `fail()` instead of being passed
through as a broken picture.

## 🖼️ Random Cecan

Seven photo endpoints, one per region, all returning the picture directly like
text2img does:

```
GET /v1/random/cecan/china        GET /v1/random/cecan/malaysia
GET /v1/random/cecan/indonesia    GET /v1/random/cecan/thailand
GET /v1/random/cecan/japan        GET /v1/random/cecan/hijaber
GET /v1/random/cecan/korea
```

The seven files under `src/apis/random/` are one line each; the behaviour lives in
the `cecan()` builder in `_cecan.js`, so a new region is a single export.

## 🕵️ Stalker

`/v1/stalk/roblox?username=DikZzXynz08` returns a Roblox profile reshaped into
this API's own snake_case envelope — `display_name`, `profile_picture`,
`created_at`, plus nested `presence`, `stats`, `badges[]` and `friends[]`.
Upstream placeholder strings like `Tidak tersedia` are normalised to `null` so a
caller can test for absence instead of matching prose. A username that doesn't
exist comes back as a 404 rather than upstream's 500.

`/v1/stalk/epepid?uid=822355534` looks up a Free Fire (Epep) profile — `name`,
`level`, `region`, `likes`, `br_rank_point`, `cs_rank_point`, `guild_name`,
`banner_image`, `created_at`, `last_login`. A UID that returns no player answers
404.

`/v1/stalk/github?user=sarperavci` returns a GitHub profile — `username`,
`name`, `bio`, `company`, `location`, `public_repos`, `followers`, `following`,
`avatar`, `profile_url`, and more. The upstream apikey is fixed server-side, so
it is never a query parameter.

`/v1/stalk/tiktok?username=<uniqueId>` returns a single TikTok profile — `id`,
`username`, `nickname`, `signature`, `region`, `verified`, `private`, `avatar`,
nested `stats` (followers / following / likes / videos) and `profile_url`. The
upstream search can return several near-matches; only the account whose
`uniqueId` matches the requested username exactly is returned, so it behaves like
a direct lookup.

`/v1/stalk/instagram?username=<handle>` returns an Instagram profile — `user_id`,
`username`, `full_name`, `bio`, `profile_picture`, nested `stats`
(followers / following / posts) and `info` (private / verified / business /
category). Missing categories come back as `null`, not the string `N/A`.

## 🔎 Search

Search endpoints proxy through `src/lib/ikyy.js` and are re-wrapped so no
upstream `creator` field leaks. Where the upstream needs an apikey it is fixed
server-side (`kyzz`) and never appears as a query parameter.

```
GET /v1/search/ytplay?q=lofi hip hop          # audio (V1)
GET /v1/search/ytplayv2?q=lofi hip hop        # audio (V2)
GET /v1/search/ytplayv3?q=lofi hip hop        # download links (V3)
GET /v1/search/youtube?query=lofi hip hop     # video result list
GET /v1/search/pinterest?q=aesthetic wallpaper # image result list
```

The three `ytplay` variants hit different upstream backends for the same intent —
if one is rate-limited or down (V3 in particular can answer 403), the others
still work, so the failure message points at the alternatives. `youtube` returns
`{ query, count, results[] }` with `title`, `channel`, `duration`, `thumbnail`,
`url`; `pinterest` returns `{ query, count, results[] }` with `image_url`,
`source` and nested `uploader`.

## 📨 Ngl Spam

`/v1/tools/ngl-spam` sends the same anonymous question to an NGL inbox several
times:

```
GET /v1/tools/ngl-spam?username=dikzz&message=hai&total=10
GET /v1/tools/ngl-spam?username=dikzz&message=hai&total=40
```

`total` defaults to 10 and is capped at 40, because a Worker gets 50 subrequests
per request and the username check spends one of them. Sends go out in waves of 5
through `Promise.allSettled`, so one rejected message doesn't abort the run — the
response reports `sent` and `failed` separately and only fails outright when
nothing landed. The username is validated once up front, so a typo answers 404
instead of quietly sending nowhere. The NGL prompt type (`slug`) is picked at
random server-side per run, so it is **not** a parameter — the chosen value is
still echoed in the response for transparency.

## 🔐 Crypto tools

These do **not** produce an opaque ciphertext — the whole point is a result you
can still run. Each `encrypt-*` tool packs the source into a small self-executing
stub in the target language: the packed file, when executed, reconstructs and
runs the original code (like a minimal packer/bundler). `decrypt` reverses any of
them back to source.

```
POST /v1/tools/encrypt-python   text=<code> | file=namafile.py   → runnable .py (zlib+base64)
POST /v1/tools/encrypt-js       text=<code> | file=namafile.js   → runnable .js (zlib+base64)
POST /v1/tools/encrypt-base64   text=<code> | file=namafile.py   → runnable .py (base64 only)
POST /v1/tools/decrypt          data=<packed> | file=namafileenc.py → original source
```

Each tool takes either `text` **or** an uploaded `file`. Uploading a script
(`multipart/form-data`, field `file`) packs its contents and hands back a
download named after the original — `namafile.py` → `namafileenc.py`. Running
`python namafileenc.py` (or `node namafileenc.js`) executes the original script.
Text mode returns JSON with the packed source by default, or a file download when
`download=true`.

The pack uses the platform `CompressionStream('deflate')`, which emits RFC-1950
zlib — so Python `zlib.decompress` and Node `zlib.inflateSync` both read it back
with no extra flags. `encrypt-python`/`encrypt-js` compress then base64;
`encrypt-base64` skips compression (base64 layer only). `decrypt` auto-detects
zlib vs plain and accepts either the whole packed file or just its base64 payload.

## 💚 WhatsApp React

`/v1/tools/whatsapp-react` sends emoji reactions to a WhatsApp *channel* post
through asitha.top's bot pool.

```
GET /v1/tools/whatsapp-react?link=<post>&emoji=❤,😍&count=1
```

`link` is a channel post URL (`https://whatsapp.com/channel/<id>/<post>`),
`emoji` is a comma-separated list (any number of emojis, default `❤,😍`), and
`count` picks how many bots react — `1`, `10`, `20`, `30`, `40`, `50`, or `all`
for every available bot.

The upstream gates each run behind an hCaptcha solve *and* a coin balance, so
`src/lib/asitha.js` does the whole handshake server-side: solve the captcha,
open a signed session (`/security/init` nonce + HMAC-SHA256 request signature),
exchange it for a short-lived token, then queue the reaction. The account bearer
(`ASITHA_BEARER`) comes from env — locally `.dev.vars`, in production
`wrangler secret put`; the captcha keys live in the D1 pool below. When the
captcha solver or the coin balance runs dry the caller gets a plain "layanan
sedang sibuk" note rather than a raw upstream failure.

## 📵 Detect OTP WhatsApp

`/v1/tools/detect-otp-whatsapp` checks how long a number must wait before it may
request a WhatsApp OTP again, and whether the number is blocked from requesting
one at all.

```
GET /v1/tools/detect-otp-whatsapp?number=<nomor>&method=sms&raw=false
```

`number` accepts formats with or without `+` (e.g. `6285757411154`), `method`
is the delivery channel to probe (`sms` / `voice` / `wa_old`), and `raw=true`
appends the untouched upstream response.

One request to WhatsApp's `/v2/code` registration endpoint returns every
`*_wait` at once, so the reply carries cooldowns for all channels, not just the
probed one:

- `cooldown.sms|voice|wa_old|email_otp|flash` — `{ seconds, human }` each;
  `0` = may request now, `-1` = the server disabled that channel,
  otherwise seconds until the next request is allowed.
- `blocked` + `block_screen` — set when WhatsApp answers `reason: blocked`,
  with the official block title/body and support URLs.
- `reason` — the verdict for the probe (`too_recent`, `too_many`, `no_routes`,
  …), and `otp_length` when the upstream actually dispatches a code.

The probe is itself a real code request, so if the probed channel's cooldown is
already `0` the upstream may dispatch an actual OTP (`status: "sent"`). The
request must look like a fresh iOS registration, so `src/lib/waotp.js`
generates a throwaway Curve25519 identity/noise/signed-prekey set per call and
signs it with the token formula from Baileys commit #290 —
`md5(secret + md5(version) + national_number)`. `WA_VERSION` can be overridden
through env without a code change.

**Proxy egress (WA_PROXIES).** WhatsApp serves datacenter egress IPs (including
Cloudflare's) a blanket `no_routes` + all-waits-3600 answer, so the endpoint
routes the probe through a randomly picked residential proxy from the
`WA_PROXIES` list (one `socks5://` or `http://` URI per line; OwlProxy speaks
both on :7778). The tunnel is hand-rolled in `src/lib/waproxy.js` — Workers'
`fetch()` cannot use forward proxies, so it speaks SOCKS5 / HTTP-CONNECT over
`cloudflare:sockets` and upgrades with `startTls()`. Up to 3 proxies are tried
on transport failure only (a dead proxy never reached WhatsApp, so rotating it
is not a second probe); if every proxy fails the probe falls back to the direct
connection and says so in `via`. The response's `via` field records which exit
served the probe, credentials masked.

Verification note: `wrangler dev` (local *and* `--remote` preview) cannot
serve TLS sockets at all — even a direct `secureTransport: "on"` connection
hangs there — so the proxy path can only be exercised on the deployed Worker.

## 🗝️ Nonecap key pool

The hCaptcha on that flow is an Enterprise sitekey with `enc_get_req`, so only a
paid solver mints a token the upstream accepts. One key is a single point of
failure, so keys live in a self-pruning D1 pool (`nonecap_keys`, see
`src/lib/keypool.js`) that is built to be filled once with 100+ keys and then
left alone.

```
/addnonecap <keys>     # newline / space / comma / ; / | separated — 100+ at once
<send a .txt file>     # same thing, for pools too big for one 4096-char message
/listnonecap           # per-key uses, fail streak, last error, idle time
/delnonecap <id>       # drop one
/clearnonecap          # wipe the pool (asks first)
```

A solve walks the **least-recently-used** keys (`src/lib/nonecap.js`, up to 5 per
request) and returns the first token it gets, so a dead key is transparently
replaced by the next one mid-request. Keys are stored once and rotated
server-side, which means all of this keeps working on the deployed Worker — no
redeploy is needed to add, rotate, or remove a key. `NONECAP_KEY` is now only a
seed used when the pool is empty, and it is never pruned (a Worker can't delete
its own env var).

Pruning is deliberately asymmetric. nonecap *does* label its auth failures, and
those labels are trusted — a key that answers `unauthorized` or `account_locked`
will never solve again. What isn't trusted is an *unlabelled* rejection (a bare
403 with no recognisable code), which is what an IP-level block or a WAF in front
of the API looks like:

| Signal | Action |
| --- | --- |
| Empty balance / no credit / quota | **deleted immediately** |
| `401 unauthorized` — invalid or revoked key, missing header | **deleted immediately** |
| `403 account_locked` — the account behind the key is shut down | **deleted immediately** |
| `5xx`, `429`, timeout, network error | never counted against the key |
| Unlabelled rejection (bare `403`, unknown 4xx) | buffered — charged to the key only if *another* key succeeded in the same request, which proves the service is up |
| Same key failing ambiguously 3x (`MAX_FAILS`) | deleted |
| `200` with no token — the solver gave up on the captcha | never counted against the key |

So an outage can't wipe a 100-key pool: if every key tried fails ambiguously,
nothing is pruned. A key that quietly dies still leaves on its third strike.
Keys are stored raw but only ever *displayed* masked (`nc_live_ab…wxyz`).

`npm run test:pool` (`scripts/test-keypool.mjs`) pins all of the above against a
fake D1 and a fake nonecap — 48 assertions, no network, no wrangler. The
response shapes in it were taken from live probes, so the classifier is tested
against what the service actually returns.

## 🤖 Userbot Telegram (Ubot Login)

Satu endpoint untuk menghubungkan dan menjalankan akun userbot Telegram (`/v1/tools/ubot-login`), dibangun dengan GramJS di Cloudflare Workers dan mendukung seluruh fitur dari `test/userbot.py`.

```
POST /v1/tools/ubot-login/sender     phone [+ api_id + api_hash] → login_token
POST /v1/tools/ubot-login/otp        login_token + code          → account_token, atau minta PIN 2FA
POST /v1/tools/ubot-login/password   login_token + password      → account_token
POST /v1/tools/ubot-login/status     account_token               → status tersambung & sinkronisasi
```

Default `api_id` (`39191050`) dan `api_hash` (`2ee2a563b5e174e6c5f8009992722284`) sudah terkonfigurasi langsung. Pengguna hanya perlu memasukkan nomor telepon, verifikasi OTP, dan PIN 2FA (jika ada).

**Perintah Userbot di Telegram:**
Setelah login berhasil, akun dapat langsung menjalankan perintah userbot di aplikasi Telegram (menggunakan format blockquote `<blockquote>`):
- `.help` — Menampilkan daftar lengkap perintah userbot
- `.ping` — Tes keaktifan userbot (membalas `🏓 Pong! Userbot aktif.`)
- `.id` — Menampilkan Info Chat ID dan User ID
- `.promosi <teks>` — Broadcast promosi ke semua grup (atau reply pesan untuk menyalin teks/media)
- `.addbl [@user/id]` — Menambahkan grup ke daftar blacklist
- `.delbl [@user/id]` — Menghapus grup dari blacklist
- `.listbl` — Melihat daftar grup yang di-blacklist
- `.setdelay <min> <max>` — Mengatur jeda acak antar pengiriman grup (dalam detik)
- `.stop` — Menghentikan semua proses promosi yang sedang berjalan

**Keamanan & Penyimpanan Sesi:** Sesi Telegram MTProto disimpan terenkripsi menggunakan AES-256-GCM (`src/lib/crypto.js`) di D1. Kunci enkripsi dapat ditentukan via secret `UBOT_SECRET` (lokal `.dev.vars`, produksi `wrangler secret put UBOT_SECRET`). Hanya hash SHA-256 dari `account_token` yang disimpan, sehingga token akun aman dan tidak dapat dibocorkan.

## 🧠 Rewind AI

`/v1/ai/chat` sits in front of the Rewind AI chat service. Keys are drawn at
random from a D1 pool (`rewind_keys`) so quota is spread across whatever keys the
owner has added, falling back to the `REWIND_KEY` var when the pool is empty. The
upstream envelope is re-wrapped so only the reply reaches a caller.

```
POST /v1/ai/chat        { "prompt": "...", "model": "anthropic/claude-haiku-4.5" }
```

It takes `prompt` (required) and an optional `model` chosen from a fixed
whitelist — `anthropic/claude-haiku-4.5` (default), `anthropic/claude-haiku-latest`,
`anthropic/claude-3-haiku`, `amazon/nova-lite-v1`, `amazon/nova-2-lite-v1`,
`amazon/nova-micro-v1`, `amazon/nova-pro-v1`, `aion-labs/aion-rp-llama-3.1-8b`,
`aion-labs/aion-3.0-mini`, `aion-labs/aion-2.0`, `arcee-ai/trinity-large-thinking`,
`deepseek/deepseek-v4-flash-0731`, `deepseek/deepseek-v4-flash`,
`deepseek/deepseek-v3.2-exp`, `deepseek/deepseek-v3.2`, `qwen/qwen3.7-plus`,
`qwen/qwen3.7-max`, `qwen/qwen3.6-plus`, `qwen/qwen3.6-max-preview`,
`qwen/qwen3.6-flash`; anything outside the list is rejected up front. It answers
`{ reply, model, type }` plus `usage` when the upstream reports it.

## ✈️ Telegram bot

An owner-only management bot is wired to `POST /api/telegram` (set it as the bot
webhook). Every update is checked against `OWNER_ID` first — anyone else gets a
polite refusal and nothing is touched. It manages both key pools:

| Command | What it does |
| --- | --- |
| `/start`, `/help` | Command list |
| `/ping` | Liveness check |
| `/stats` | Endpoint + key-pool counts (rewind and nonecap) |
| `/addrewind <k>` | Add a key; pipe-separate (`k1\|k2\|k3`) to bulk-add |
| `/listrewind` | List keys as inline buttons — tap one for Hapus / Kembali |
| `/delrewind <id>` | Delete a key by id |
| `/createrewind <n> <w>` | Auto-provision `n` rewind accounts (`w` lanes, default 10) |
| `/addnonecap <keys>` | Bulk-add captcha keys — newline / space / comma separated |
| `/listnonecap` | Pool health: uses, fail streak, last error, idle time |
| `/delnonecap <id>` | Drop one captcha key |
| `/clearnonecap` | Wipe the captcha pool (inline confirmation) |

Sending a **`.txt` document** to the bot loads it into the nonecap pool as an
`/addnonecap` batch (≤512 KB); caption it `/addrewind` to load the rewind pool
instead. That's the route for a 100+ key list, since a single Telegram message
caps at 4096 characters (~95 keys).

`/createrewind` runs the whole signup flow headlessly, so the pool can be
refilled without touching a browser: claim a temp `.edu` address from our own
`/v1/tools/mailedu`, `POST /v1/auth/signup`, poll that inbox until the
verification mail lands and lift the `?token=` out of its link, verify, then
`POST /v1/api-keys` — and the resulting `sk-rewind-…` goes straight into the D1
pool. Provisioning is dispatched through `ctx.waitUntil` so Telegram gets its 200
immediately, and progress is reported by editing one message in place rather than
spamming the chat. Verification is best-effort: the API mints a working key even
while `emailVerifiedAt` is null, so a mail hiccup reports `unverified` instead of
discarding the account. Capped at 40 accounts per command (a Worker gets 1000
subrequests per invocation and each account costs ~15-20).

A fresh account starts with a 10 000-token balance, which is why an
`Insufficient tokens: required 150, available 70` reply from `/v1/ai/chat` is a
**quota** problem on the key rather than a broken model — every model in the
whitelist was verified against a full-balance key.

Keys are only ever shown masked (`sk-xxx…abcd`); the full secret never lands in a
chat log. The token and owner id come from `wrangler.toml [vars]`. The bot creates
both the `rewind_keys` and `nonecap_keys` tables defensively, so it works even
before `schema.sql` is applied.

## ⌨️ Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Local server on `http://127.0.0.1:8787` |
| `npm run deploy` | Publish to `api.makluxnxx.my.id` |
| `npm run db:init` | Apply `schema.sql` to the remote D1 database |
| `npm run db:init:local` | Same, for the local dev database |
| `npm run new` | Scaffold a new endpoint |
| `npm run test:pool` | Key-pool rotation + auto-delete tests (offline) |
| `npm run tail` | Stream live production logs |

## 🛰️ Meta routes

| Route | Purpose |
| --- | --- |
| `GET /api/catalog` | Endpoint catalog the docs page renders from |
| `GET /api/stats` | 24 h window, monthly + all-time totals, top endpoints, feed |
| `GET /api/system` | Runtime, RAM/CPU labels, serving colo |
| `GET /api/health` | Uptime + endpoint count |

## 📊 Stats

`/api/stats` returns four groups. `window` covers the **last 24 hours only** and
is what the dashboard's headline cards and Latest Requests feed read from;
`month` and `totals` come from the permanent daily ledger and keep counting.

The reset needs no cron trigger and no stored marker: every write deletes
`recent_requests` rows older than 24 hours, so the live numbers fall as traffic
ages out. `resets_in_ms` is measured from the oldest surviving row — that's when
the current window began. A row cap of 5000 keeps the aggregate queries cheap if
traffic spikes.

## 🤖 AI

`/v1/ai/dola` is an interactive chat endpoint — send `prompt`, get `reply` (max
4000 characters). `/v1/ai/llama` and `/v1/ai/mistral` run on Workers AI, and
`translate` is a task-shaped wrapper over the same models. `/v1/ai/chat` runs on
Rewind AI — see the **Rewind AI** section.

## 🎬 Alight Motion activation

One endpoint drives the whole flow, filed under Tools. The `link` parameter is
what selects the step — leave it out to request the sign-in mail, pass it to
finish activation:

```
GET /v1/tools/alightmotion?email=you@gmail.com                     # → step: link_sent
GET /v1/tools/alightmotion?email=you@gmail.com&link=<url from inbox> # → step: activated
```

Calling it again without `link` while a job is still pending answers
`step: waiting_verification` with the remaining quota instead of burning
another slot — that's the status check, no separate route needed.

This works statelessly because `src/lib/alight.js` derives the upstream account
password from the email (`SHA-256("amgen::" + email)`), so any call can rebuild
the same session. The newest pending job is resolved when verifying, so no
`job_id` has to be threaded through.

The link expires after ~30 minutes, each one is single-use, and the quota is
2 activations per day per account.

## 📬 Temp mail

Two services, one endpoint each, both pairing with the flow above.

`/v1/tools/emailqu` issues addresses on a single domain, `@bahlil.codes`. emailqu
addresses are virtual — nothing is created server-side, so an address is readable
the moment it's handed out:

```
GET /v1/tools/emailqu                                    # random address
GET /v1/tools/emailqu?user=dikzz                         # custom username
GET /v1/tools/emailqu?email=dikzz@bahlil.codes&limit=10  # read the inbox
```

The domain is not selectable. emailqu lists ~4600 domains but most are
unroutable or disappear without notice, and a caller who picked one by hand got a
dead address with no way to tell — so one verified domain is handed out instead.

`/v1/tools/mailedu` issues temporary **.edu** addresses, which is what
student-discount and university sign-ups check for. Only two domains exist
upstream: `@iunp.edu.rs` and `@warsawuni.edu.pl`.

```
GET /v1/tools/mailedu                                          # random claimed address
GET /v1/tools/mailedu?user=dikzz&domain=warsawuni.edu.pl       # custom address
GET /v1/tools/mailedu?email=dikzz@iunp.edu.rs                  # read the inbox
GET /v1/tools/mailedu?email=dikzz@iunp.edu.rs&uid=1            # one full message
```

Unlike emailqu, an address here must be *claimed* first (`POST /guest`) before
the inbox exists, and the claim expires after ~2 hours — `expires_at` says when.
A name that's already taken fails with 409 rather than handing back an inbox
somebody else is reading. The transport also has to send the site's own
`x-powered-by: EXPRE55` header or every write answers `429 Too many requests`,
regardless of the rate-limit headers.

Both endpoints lift `otp` and `verification_link` to the top level from the
newest message that has one, so a bot can read `result.otp` without walking the
message list. The extraction lives in `src/lib/mailparse.js` and handles numeric
OTPs, alphanumeric tokens and magic sign-in links. Bodies are quoted-printable
decoded first: mail wraps long URLs across lines with a trailing `=` and writes
`=` as `=3D`, so in raw form an `href=3D'…'` never matches and the only link in
the message would be lost.

## 🛡️ Bypass

`/v1/bypass/turnstile-min` solves a Cloudflare Turnstile challenge and returns a
token ready to submit as the target form's `cf-turnstile-response` field:

```
GET /v1/bypass/turnstile-min?url=https%3A%2F%2Ftarget.com%2Fsign-up&sitekey=0x4AAAAAAE...
```

`sitekey` comes from the `data-sitekey` attribute on the target page. Solving is
a real browser round-trip upstream — measured 4–8 s — so the timeout is raised to
90 s; the shared 15 s default would turn a normal solve into a spurious failure.
The upstream answer is re-wrapped in this API's own envelope, so its `creator`
field never reaches a caller. Tokens are single-use and expire quickly.

`/v1/bypass/sfl?url=https%3A%2F%2Fsfl.gl%2FNQYsS` resolves an sfl.gl / shorten
link to its real destination, returning `original_url`, `destination_url` and a
`message`. The upstream answer is re-wrapped in this API's envelope.

## 📸 Screenshot Web

`/v1/tools/ssweb?url=https%3A%2F%2Fexample.com` captures a full-page screenshot
and returns the **image directly** (`image/png`), not a JSON wrapper — so it can
be embedded straight into an `<img>` or saved to disk. The upstream call gets the
90 s image timeout since rendering a page takes several seconds.

## 📦 Response format

```json
{ "status": true,  "creator": "DikZz Xynzz — t.me/maklohytam", "result": {} }
{ "status": false, "creator": "DikZz Xynzz — t.me/maklohytam", "message": "..." }
```

Every call is recorded in D1 through `ctx.waitUntil`, so tracking never adds
latency and a database outage can't fail a request.

Endpoints that sit in front of a third-party service (Dola, Roblox Stalk, Cecan,
text2img, Turnstile) go through `src/lib/ikyy.js`, which returns only the payload
and throws on anything else. The upstream stamps its own `creator` on every JSON
body, and re-wrapping is what keeps that out of a DIKZZAPI response.

## 📞 Contact

<div align="center">

| Kanal | Link |
| --- | --- |
| 💚 WhatsApp | [wa.me/6285757411154](https://wa.me/6285757411154) |
| ✈️ Telegram | [t.me/maklohytam](https://t.me/maklohytam) |
| ✈️ Telegram (backup) | [t.me/dikzxinxz](https://t.me/dikzxinxz) |

<br>

**Dibangun & dirawat oleh DikZz Xynzz** · berjalan di Cloudflare Workers ⚡

<sub>© DIKZZAPI — <a href="https://api.makluxnxx.my.id">api.makluxnxx.my.id</a></sub>

</div>
