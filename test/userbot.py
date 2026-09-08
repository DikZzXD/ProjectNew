"""
Userbot Telegram - Promosi ke Grup
Pakai Telethon (login akun asli, bukan bot token).

Jalankan: python userbot.py
Perintah: .promosi <teks> | .addbl | .delbl | .listbl | .setdelay | .stop | .ping | .id | .help
"""

import os
import json
import asyncio
import random

from telethon import TelegramClient, events
from telethon.errors import (
    SessionPasswordNeededError,
    FloodWaitError,
    ChatWriteForbiddenError,
    UserBannedInChannelError,
    ChannelPrivateError,
)

CONFIG_FILE = "config.json"
SESSION_NAME = "userbot"

# placeholder-config
DEFAULT_CONFIG = {
    "api_id": 0,
    "api_hash": "",
    "delay_min": 5,
    "delay_max": 12,
    "blacklist": [],
}


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
def load_config():
    cfg = dict(DEFAULT_CONFIG)
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                cfg.update(json.load(f))
        except (json.JSONDecodeError, OSError):
            print("[!] config.json rusak, memakai default.")
    return cfg


def save_config(cfg):
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)


config = load_config()

# State runtime: banyak job promosi bisa jalan bersamaan.
# jobs[id] = {"task": asyncio.Task, "stop": bool, "chat_id": int}
JOBS = {}
JOB_SEQ = {"n": 0}


# ---------------------------------------------------------------------------
# Helper tampilan
# ---------------------------------------------------------------------------
def bq(text: str) -> str:
    """Bungkus tiap baris jadi blockquote HTML."""
    return "<blockquote>" + text + "</blockquote>"


async def reply_bq(event, text: str):
    """Balas pesan dalam format blockquote."""
    await event.reply(bq(text), parse_mode="html")


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------
def ensure_api_credentials():
    """Minta api_id / api_hash kalau belum ada, lalu simpan."""
    if not config.get("api_id") or not config.get("api_hash"):
        print("== Setup API (sekali saja) ==")
        print("Ambil di https://my.telegram.org > API development tools\n")
        while True:
            try:
                config["api_id"] = int(input("Masukkan api_id  : ").strip())
                break
            except ValueError:
                print("api_id harus angka.")
        config["api_hash"] = input("Masukkan api_hash: ").strip()
        save_config(config)


# ---------------------------------------------------------------------------
# Blacklist helpers
# ---------------------------------------------------------------------------
async def resolve_target_id(client, ref):
    """Ubah @username / id / -100id jadi id numerik. None kalau gagal."""
    ref = str(ref).strip()
    try:
        if ref.lstrip("-").isdigit():
            ent = await client.get_entity(int(ref))
        else:
            ent = await client.get_entity(ref)
        return ent.id
    except Exception:
        return None


def in_blacklist(chat_id) -> bool:
    return int(chat_id) in [int(x) for x in config.get("blacklist", [])]


# ---------------------------------------------------------------------------
# Bangun konten promosi
# ---------------------------------------------------------------------------
async def send_promo_to(client, target, source_msg, plain_text):
    """
    Kirim promosi ke satu target.
    - Kalau source_msg (pesan yang di-reply) ada -> teruskan apa adanya
      (teks + entities termasuk emoji premium/custom + media).
    - Kalau tidak, kirim plain_text biasa.
    """
    if source_msg is not None:
        # Pertahankan teks, formatting, custom/premium emoji, dan media.
        await client.send_message(
            target,
            message=source_msg.message or "",
            formatting_entities=source_msg.entities or None,
            file=source_msg.media if source_msg.media else None,
        )
    else:
        await client.send_message(target, plain_text)


# ---------------------------------------------------------------------------
# Client + handler registration
# ---------------------------------------------------------------------------
ensure_api_credentials()
client = TelegramClient(SESSION_NAME, config["api_id"], config["api_hash"])


def register_handlers():
    # Cuma perintah dari akun sendiri (outgoing)
    def cmd(pattern):
        return events.NewMessage(outgoing=True, pattern=pattern)

    # .ping ---------------------------------------------------------------
    @client.on(cmd(r"^\.ping$"))
    async def _ping(event):
        await event.edit(bq("🏓 Pong! Userbot aktif."), parse_mode="html")

    # .id -----------------------------------------------------------------
    @client.on(cmd(r"^\.id$"))
    async def _id(event):
        chat = await event.get_chat()
        me = await event.get_sender()
        text = (
            f"🆔 Info\n"
            f"Chat ID : {event.chat_id}\n"
            f"User ID : {getattr(me, 'id', '-')}"
        )
        await event.edit(bq(text), parse_mode="html")

    # .help ---------------------------------------------------------------
    @client.on(cmd(r"^\.help$"))
    async def _help(event):
        text = (
            "📖 Daftar Perintah\n"
            ".promosi &lt;teks&gt; — kirim ke semua grup (bisa reply pesan)\n"
            ".addbl [@user/id] — blacklist grup\n"
            ".delbl [@user/id] — hapus dari blacklist\n"
            ".listbl — lihat blacklist\n"
            ".setdelay &lt;min&gt; &lt;max&gt; — atur jeda (detik)\n"
            ".stop — hentikan promosi\n"
            ".ping / .id — info"
        )
        await event.edit(bq(text), parse_mode="html")

    # .setdelay -----------------------------------------------------------
    @client.on(cmd(r"^\.setdelay(?:\s+(\d+)\s+(\d+))?$"))
    async def _setdelay(event):
        m = event.pattern_match
        if not m.group(1):
            await event.edit(
                bq(f"⏱ Delay sekarang: {config['delay_min']}–{config['delay_max']} detik.\n"
                   "Ubah: .setdelay <min> <max>"),
                parse_mode="html",
            )
            return
        lo, hi = int(m.group(1)), int(m.group(2))
        if lo > hi:
            lo, hi = hi, lo
        config["delay_min"], config["delay_max"] = lo, hi
        save_config(config)
        await event.edit(bq(f"✅ Delay diset {lo}–{hi} detik."), parse_mode="html")

    # .stop ---------------------------------------------------------------
    @client.on(cmd(r"^\.stop$"))
    async def _stop(event):
        active = [j for j in JOBS.values() if not j["stop"]]
        if not active:
            await event.edit(bq("Tidak ada promosi yang berjalan."), parse_mode="html")
            return
        for j in JOBS.values():
            j["stop"] = True
        await event.edit(
            bq(f"🛑 Menghentikan {len(active)} promosi yang berjalan..."),
            parse_mode="html",
        )

    # .addbl --------------------------------------------------------------
    @client.on(cmd(r"^\.addbl(?:\s+(.+))?$"))
    async def _addbl(event):
        arg = event.pattern_match.group(1)
        if arg:
            tid = await resolve_target_id(client, arg.strip())
            if tid is None:
                await event.edit(bq("❌ Grup/target tidak ditemukan."), parse_mode="html")
                return
        else:
            tid = event.chat_id  # grup tempat perintah diketik
        bl = config.setdefault("blacklist", [])
        if int(tid) in [int(x) for x in bl]:
            await event.edit(bq("ℹ️ Grup itu sudah di blacklist."), parse_mode="html")
            return
        bl.append(int(tid))
        save_config(config)
        await event.edit(bq(f"✅ Ditambahkan ke blacklist: {tid}"), parse_mode="html")

    # .delbl --------------------------------------------------------------
    @client.on(cmd(r"^\.delbl(?:\s+(.+))?$"))
    async def _delbl(event):
        arg = event.pattern_match.group(1)
        if arg:
            tid = await resolve_target_id(client, arg.strip())
            if tid is None:
                await event.edit(bq("❌ Grup/target tidak ditemukan."), parse_mode="html")
                return
        else:
            tid = event.chat_id
        bl = config.setdefault("blacklist", [])
        bl_int = [int(x) for x in bl]
        if int(tid) not in bl_int:
            await event.edit(bq("ℹ️ Grup itu tidak ada di blacklist."), parse_mode="html")
            return
        config["blacklist"] = [x for x in bl if int(x) != int(tid)]
        save_config(config)
        await event.edit(bq(f"✅ Dihapus dari blacklist: {tid}"), parse_mode="html")

    # .listbl -------------------------------------------------------------
    @client.on(cmd(r"^\.listbl$"))
    async def _listbl(event):
        bl = config.get("blacklist", [])
        if not bl:
            await event.edit(bq("📭 Blacklist kosong."), parse_mode="html")
            return
        lines = ["🚫 Daftar Blacklist:"]
        for i, x in enumerate(bl, 1):
            lines.append(f"{i}. {x}")
        await event.edit(bq("\n".join(lines)), parse_mode="html")

    # .promosi ------------------------------------------------------------
    @client.on(cmd(r"^\.promosi(?:\s+([\s\S]+))?$"))
    async def _promosi(event):
        # Sumber konten: pesan yang di-reply, atau teks argumen.
        reply_msg = await event.get_reply_message()
        arg_text = event.pattern_match.group(1)

        if reply_msg is None and not arg_text:
            await event.edit(
                bq("Cara pakai:\n.promosi <teks>\n"
                   "atau reply sebuah pesan lalu ketik .promosi"),
                parse_mode="html",
            )
            return

        plain_text = arg_text.strip() if arg_text else ""

        # Buat job baru & jalankan di background (non-blocking).
        JOB_SEQ["n"] += 1
        job_id = JOB_SEQ["n"]
        chat_id = event.chat_id

        await event.edit(
            bq(f"🚀 Promosi #{job_id} dimulai di background.\n"
               "Kamu tetap bisa jalankan .promosi lain atau perintah lain.\n"
               "Ketik .stop untuk menghentikan."),
            parse_mode="html",
        )

        task = asyncio.create_task(
            _run_promo(job_id, chat_id, reply_msg, plain_text)
        )
        JOBS[job_id] = {"task": task, "stop": False, "chat_id": chat_id}


async def _run_promo(job_id, chat_id, reply_msg, plain_text):
    """Worker promosi yang jalan di background, satu per job."""
    job = JOBS[job_id]
    try:
        # Ambil semua grup, lewati channel broadcast & blacklist.
        groups = []
        async for dialog in client.iter_dialogs():
            if dialog.is_group and not in_blacklist(dialog.id):
                groups.append(dialog)

        total = len(groups)
        if total == 0:
            await client.send_message(
                chat_id, bq(f"Promosi #{job_id}: tidak ada grup."), parse_mode="html"
            )
            return

        await client.send_message(
            chat_id,
            bq(f"🚀 Promosi #{job_id}: mengirim ke {total} grup...\n"
               f"Jeda {config['delay_min']}–{config['delay_max']} detik/grup."),
            parse_mode="html",
        )

        sukses, gagal, dilewati = 0, 0, 0
        for idx, dialog in enumerate(groups, 1):
            if job["stop"]:
                break
            try:
                await send_promo_to(client, dialog.id, reply_msg, plain_text)
                sukses += 1
            except FloodWaitError as e:
                wait = min(e.seconds + 2, 300)
                await asyncio.sleep(wait)
                try:
                    await send_promo_to(client, dialog.id, reply_msg, plain_text)
                    sukses += 1
                except Exception:
                    gagal += 1
            except (ChatWriteForbiddenError, UserBannedInChannelError,
                    ChannelPrivateError):
                dilewati += 1
            except Exception:
                gagal += 1

            # Jeda acak antar grup (kecuali grup terakhir).
            if idx < total and not job["stop"]:
                await asyncio.sleep(
                    random.uniform(config["delay_min"], config["delay_max"])
                )

        status = "🛑 Dihentikan" if job["stop"] else "✅ Selesai"
        hasil = (
            f"{status} — Promosi #{job_id}\n"
            f"Berhasil : {sukses}\n"
            f"Gagal    : {gagal}\n"
            f"Dilewati : {dilewati}\n"
            f"Total    : {total}"
        )
        await client.send_message(chat_id, bq(hasil), parse_mode="html")
    except asyncio.CancelledError:
        raise
    except Exception as e:
        await client.send_message(
            chat_id, bq(f"❌ Promosi #{job_id} error: {e}"), parse_mode="html"
        )
    finally:
        JOBS.pop(job_id, None)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
async def main():
    register_handlers()
    print("Menghubungkan ke Telegram...")
    await client.connect()

    if not await client.is_user_authorized():
        phone = input("Masukkan nomor telepon (mis. +628123456789): ").strip()
        await client.send_code_request(phone)
        try:
            code = input("Masukkan kode OTP: ").strip()
            await client.sign_in(phone=phone, code=code)
        except SessionPasswordNeededError:
            pw = input("Akun pakai 2FA. Masukkan password: ").strip()
            await client.sign_in(password=pw)

    me = await client.get_me()
    nama = me.first_name or ""
    uname = f" (@{me.username})" if me.username else ""
    print(f"\n✅ Login sukses sebagai: {nama}{uname}")
    print("Userbot berjalan. Ketik .help di Telegram. Tekan Ctrl+C untuk berhenti.\n")

    await client.run_until_disconnected()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nUserbot dihentikan.")
