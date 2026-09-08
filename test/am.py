import re
import time
import hashlib
import requests

API_BASE = "https://am.caggyshop.my.id"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36"
)


def valid_email(s):
    return bool(re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", (s or "").strip()))


def headers(referer_path="/app"):
    return {
        "Content-Type": "application/json",
        "Accept": "*/*",
        "Origin": API_BASE,
        "Referer": f"{API_BASE}{referer_path}",
        "User-Agent": UA,
    }


def derive_password(email):
    """Password deterministik dari email, biar re-run bisa login ulang."""
    d = hashlib.sha256(f"amgen::{email.lower().strip()}".encode()).hexdigest()
    return "Am" + d[:12] + "9x"


def err_of(data, r, fallback):
    if isinstance(data, dict):
        return data.get("error") or data.get("message") or fallback
    return fallback


def as_json(r):
    try:
        return r.json()
    except Exception:
        return {}


def auth(session, email):
    """Daftar akun (auto-verified, tanpa turnstile/OTP). Kalau udah ada -> login."""
    password = derive_password(email)

    r = session.post(f"{API_BASE}/api/auth/register",
                     headers=headers("/auth/register"),
                     json={"email": email, "password": password, "terms": True},
                     timeout=60)
    data = as_json(r)

    if r.status_code < 400 and data.get("user"):
        return True, "Akun terdaftar & terverifikasi otomatis"

    if r.status_code != 409:
        return False, err_of(data, r, f"Register gagal (HTTP {r.status_code})")

    r = session.post(f"{API_BASE}/api/auth/login",
                     headers=headers("/auth/login"),
                     json={"email": email, "password": password},
                     timeout=60)
    data = as_json(r)
    if r.status_code < 400 and data.get("user"):
        return True, "Login ke akun lama"
    return False, err_of(data, r, f"Login gagal (HTTP {r.status_code})")


def quota(session):
    r = session.get(f"{API_BASE}/api/generate", headers=headers("/app"), timeout=60)
    return as_json(r)


def send_link(session, email):
    """Minta link aktivasi dikirim ke email Alight Motion."""
    r = session.post(f"{API_BASE}/api/generate",
                     headers=headers("/app"),
                     json={"amEmail": email}, timeout=90)
    data = as_json(r)
    if r.status_code >= 400 or not data.get("id"):
        return None, err_of(data, r, f"Gagal minta link (HTTP {r.status_code})")
    return data, "Link aktivasi terkirim"


def skip_ads():
    """Iklan di web cuma timer client-side (3 x 5 detik), nggak ada endpoint
    server yang dicatat. Jadi langsung dilewat."""
    return True


def verify(session, job_id, link):
    r = session.post(f"{API_BASE}/api/generate/{job_id}/verify-link",
                     headers=headers("/app"),
                     json={"link": link}, timeout=120)
    data = as_json(r)
    if r.status_code >= 400:
        return False, err_of(data, r, f"Verifikasi gagal (HTTP {r.status_code})"), data

    state = data.get("state")
    if state == "SUCCESS":
        return True, data.get("activationDetail") or "Fitur berhasil diaktifkan", data
    return False, err_of(data, r, f"Belum aktif (state: {state})"), data


def fmt_ms(ms):
    ms = max(int(ms or 0), 0)
    s = ms // 1000
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


def main():
    session = requests.Session()

    email = input("Masukin email Alight Motion (yang mau dipremiumkan): ").strip()
    if not valid_email(email):
        print("Email tidak valid.")
        return

    print("Daftar / login akun ...")
    ok, msg = auth(session, email)
    if not ok:
        print(f"Gagal: {msg}")
        return
    print(f"OK: {msg}")

    q = quota(session)
    used, limit = q.get("usedToday", 0), q.get("dailyLimit", 2)
    wait = q.get("retryAfterMs", 0)
    if wait:
        print(f"Masih cooldown. Tunggu {fmt_ms(wait)} lagi.")
        return
    if used >= limit:
        print(f"Kuota harian habis ({used}/{limit}).")
        return
    print(f"Kuota: {used}/{limit}")

    print("Bypass nonton iklan ...")
    skip_ads()
    print("OK: iklan dilewat (timer client-side, nggak dicek server).")

    print(f"Ngirim link aktivasi ke {email} ...")
    job, msg = send_link(session, email)
    if not job:
        print(f"Gagal: {msg}")
        return
    print("Link terkirim. Buka email Alight Motion, cari mail "
          '"Sign in to Alight Creative", tekan-tahan tombolnya lalu Salin URL.')
    print("Link berlaku ~30 menit.")

    link = input("Masukin link verifikasi: ").strip()
    if not link.lower().startswith("http"):
        print("Link tidak valid.")
        return

    print("Verifikasi + aktivasi premium ...")
    premium, msg, data = verify(session, job["id"], link)
    if not premium:
        print(f"Gagal: {msg}")
        return

    print()
    print("Selesai!")
    print(f"Email  : {data.get('amEmail') or email}")
    print(f"Status : Premium ({msg})")
    print("Durasi : 1 Tahun")


if __name__ == "__main__":
    main()
