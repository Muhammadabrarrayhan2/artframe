"""
Full end-to-end test of the ArtFrame backend using FastAPI's TestClient.
Exercises: register -> verify-otp -> me -> upload image -> list -> detail -> logout -> 401 -> forgot-password request -> forgot-password verify -> reset -> re-login
"""
import io
import os
import shutil
import sys
import traceback

# Clean slate
for p in ["artframe.db"]:
    if os.path.exists(p):
        os.remove(p)
if os.path.exists("storage"):
    shutil.rmtree("storage")

from fastapi.testclient import TestClient
from PIL import Image

from app.main import app


def pretty(r):
    return f"HTTP {r.status_code} :: {r.text[:400]}"


def main():
    with TestClient(app) as client:
        _run(client)


def _run(client):
    print("\n[1] GET /health")
    r = client.get("/health")
    print("  ", pretty(r))
    assert r.status_code == 200

    print("\n[2] POST /auth/register")
    r = client.post(
        "/api/v1/auth/register",
        json={"email": "rayhan@example.com", "name": "Rayhan", "password": "SuperSecret123"},
    )
    print("  ", pretty(r))
    assert r.status_code == 201
    register_code = r.json()["dev_code"]
    print(f"  Register code: {register_code}")

    print("\n[3] POST /auth/verify-otp")
    r = client.post(
        "/api/v1/auth/verify-otp",
        json={"email": "rayhan@example.com", "code": register_code},
    )
    print("  ", pretty(r))
    assert r.status_code == 200
    token = r.json()["access_token"]
    print(f"  Token: {token[:32]}...")

    H = {"Authorization": f"Bearer {token}"}

    print("\n[4] GET /auth/me")
    r = client.get("/api/v1/auth/me", headers=H)
    print("  ", pretty(r))
    assert r.status_code == 200

    print("\n[5] POST /media/upload (synthetic test image)")
    img = Image.new("RGB", (256, 256), color=(120, 140, 180))
    for x in range(256):
        for y in range(256):
            img.putpixel((x, y), ((x + y) % 256, (x * 2) % 256, (y * 3) % 256))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    buf.seek(0)
    r = client.post(
        "/api/v1/media/upload",
        headers=H,
        files={"file": ("test.png", buf, "image/png")},
        data={"consent": "true"},
    )
    print("  ", pretty(r))
    assert r.status_code == 201, "upload failed"
    upload_json = r.json()
    media_id = upload_json["media"]["id"]
    verdict = upload_json["analysis"]["verdict"]
    prob = upload_json["analysis"]["ai_probability"]
    print(f"  media_id={media_id} verdict={verdict} ai_prob={prob}")

    print("\n[6] GET /media/{id}")
    r = client.get(f"/api/v1/media/{media_id}", headers=H)
    print("  ", pretty(r))
    assert r.status_code == 200

    print("\n[7] GET /media/stats/summary")
    r = client.get("/api/v1/media/stats/summary", headers=H)
    print("  ", pretty(r))
    assert r.status_code == 200

    print("\n[8] GET /lab/styles")
    r = client.get("/api/v1/lab/styles", headers=H)
    print("  ", pretty(r))
    assert r.status_code == 200

    print("\n[9] POST /lab/transform (sketch)")
    buf.seek(0)
    r = client.post(
        "/api/v1/lab/transform",
        headers=H,
        files={"file": ("t.png", buf, "image/png")},
        data={"style": "sketch", "consent_own_media": "true", "consent_ai_label": "true"},
    )
    print("  ", pretty(r))
    assert r.status_code == 201, "transform failed"

    print("\n[10] POST /auth/logout")
    r = client.post("/api/v1/auth/logout", headers=H)
    print("  ", pretty(r))
    assert r.status_code == 200

    print("\n[11] GET /auth/me after logout (expect 401)")
    r = client.get("/api/v1/auth/me", headers=H)
    print("  ", pretty(r))
    assert r.status_code == 401

    print("\n[12] POST /auth/forgot-password/request")
    r = client.post("/api/v1/auth/forgot-password/request", json={"email": "rayhan@example.com"})
    print("  ", pretty(r))
    assert r.status_code == 200
    reset_code = r.json()["dev_code"]
    print(f"  Reset code: {reset_code}")

    print("\n[13] POST /auth/forgot-password/verify")
    r = client.post(
        "/api/v1/auth/forgot-password/verify",
        json={"email": "rayhan@example.com", "code": reset_code},
    )
    print("  ", pretty(r))
    assert r.status_code == 200

    print("\n[14] POST /auth/forgot-password")
    r = client.post(
        "/api/v1/auth/forgot-password",
        json={"email": "rayhan@example.com", "code": reset_code, "new_password": "EvenMoreSecret456"},
    )
    print("  ", pretty(r))
    assert r.status_code == 200

    print("\n[15] POST /auth/login with old password (expect 401)")
    r = client.post(
        "/api/v1/auth/login",
        json={"email": "rayhan@example.com", "password": "SuperSecret123"},
    )
    print("  ", pretty(r))
    assert r.status_code == 401

    print("\n[16] POST /auth/login (re-login)")
    r = client.post(
        "/api/v1/auth/login",
        json={"email": "rayhan@example.com", "password": "EvenMoreSecret456"},
    )
    print("  ", pretty(r))
    assert r.status_code == 200
    new_token = r.json()["access_token"]
    print(f"  Got new token: {new_token[:32]}...")

    print("\n" + "=" * 60)
    print("  ALL TESTS PASSED")
    print("=" * 60)


if __name__ == "__main__":
    try:
        main()
    except AssertionError as e:
        print(f"\nFAIL: {e}")
        traceback.print_exc()
        sys.exit(1)
    except Exception as e:
        print(f"\nERROR: {e}")
        traceback.print_exc()
        sys.exit(2)
