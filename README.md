# ArtFrame

> **Responsible AI media forensics** — detect AI-generated images, video, and audio with transparent ensemble signals, plus a safety-first Transformation Lab for stylized (never impersonating) synthetic media.

ArtFrame is a full-stack portfolio-grade web application:

- **Backend** — FastAPI + async SQLAlchemy + PyTorch-free forensic ensemble (numpy + Pillow + OpenCV)
- **Frontend** — Next.js 14 (App Router) + Tailwind + TypeScript, premium editorial dark aesthetic
- **Auth** — JWT with server-side session revocation, instant account activation, bcrypt hashing, audit logging
- **Safety** — watermarked outputs, daily quotas, dual consent gates, zero identity-imitation features

Live demo : https://artframe-1da506hwl-muhammadabrarrayhan2s-projects.vercel.app/
---

## Table of contents

1. Quick start
2. What ArtFrame detects
3. Project structure
4. Backend reference
5. Frontend reference
6. Running & development
7. Security model
8. Limits and responsible-use policy

---

## 1. Quick start

You need **Python 3.11+** and **Node.js 20+** installed.

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
python -m uvicorn app.main:app --reload
```

The API is now on `http://127.0.0.1:8000`. Interactive docs: `http://127.0.0.1:8000/docs`.

> **Dev email mode**: email delivery can use SendGrid or SMTP, with console fallback if provider config is incomplete.

### Frontend

In a second terminal:

```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

The app is now on `http://127.0.0.1:3000`. Register and you'll be signed in immediately.

### Optional — run the end-to-end backend test

```bash
cd backend
PYTHONPATH=. python tests/e2e.py
```

This exercises: register → me → upload image → analyze → list → stats → lab transform → logout → 401 → re-login, and prints each response.

---

## 2. What ArtFrame detects

### Images — 6-signal forensic ensemble

| Signal | What it checks | Weight |
|---|---|---|
| **Metadata / EXIF** | Presence of camera make/model, capture time, `Software` tag hints | 0.10 |
| **Error Level Analysis** | Re-compress at fixed JPEG quality, diff against original. Flat ELA = synthetic | 0.18 |
| **Frequency domain** | 2D FFT radial profile. Diffusion models over-smooth high frequencies | 0.22 |
| **Sensor noise residual** | Laplacian variance on flat regions. Natural photos have specific photon noise | 0.18 |
| **Block texture variance** | 16×16 block variance distribution. Many ultra-smooth blocks = suspicious | 0.17 |
| **File header** | PNG without compression history, `stable-diffusion` / `midjourney` / `dall-e` markers | 0.15 |

Each signal is scored 0–1 independently with a plain-language reason. The final verdict is a weighted ensemble; confidence is 1 − σ of the signals (agreement between signals).

**Verdict bands**: `likely_ai` ≥ 0.65 · `inconclusive` 0.35–0.65 · `likely_real` ≤ 0.35

### Video — per-frame + temporal

Samples up to 8 frames across the duration, runs the image ensemble on each, and adds temporal signals (frame-to-frame diff mean/std). A frame timeline is returned so you can see per-second AI probability.

### Audio — spectral profile

Numpy-only analysis (so it runs without librosa) covering:
- Crest factor (dynamic range)
- Spectral flatness across windowed frames
- High-frequency roll-off ratio

### Transformation Lab

A safety-first playground with 8 **stylized** filters:

- Sketch · Oil painting · Watercolor · Cyberpunk · Vintage · Duotone · Mosaic · Pixelate

Deliberate limitations:
- **No face-swap, no voice cloning, no identity transfer**
- Every output has a diagonal tiled watermark AND a corner badge AND JPEG-comment metadata tagging it as `AI-GENERATED`
- Daily quota: **10 transformations per user per day**
- Dual consent: user must confirm ownership AND accept the AI-labelled output
- All runs are audit-logged with IP and user-agent

---

## 3. Project structure

```
artframe/
├── backend/
│   ├── app/
│   │   ├── api/              # FastAPI routers
│   │   │   ├── auth.py       # register, login, logout, logout-all, me
│   │   │   ├── media.py      # upload, list, get, delete, stats, file
│   │   │   └── lab.py        # styles, quota, transform, download
│   │   ├── core/
│   │   │   ├── config.py     # pydantic-settings
│   │   │   ├── database.py   # async SQLAlchemy 2.0
│   │   │   ├── deps.py       # get_current_user with session revocation check
│   │   │   ├── security.py   # bcrypt + JWT with per-token jti
│   │   │   └── ratelimit.py  # in-memory (IP, action) limiter
│   │   ├── models/           # User, OTPCode, UserSession, MediaFile, AnalysisResult, AuditLog
│   │   ├── schemas/          # Pydantic DTOs
│   │   ├── services/
│   │   │   ├── otp_service.py     # generate/verify OTP, SendGrid/SMTP delivery, console fallback
│   │   │   └── audit_service.py   # structured audit logger
│   │   ├── ml/
│   │   │   ├── image_detector.py  # 6-signal forensic ensemble
│   │   │   ├── audio_detector.py  # numpy spectral analysis
│   │   │   └── video_detector.py  # OpenCV per-frame + temporal
│   │   └── main.py           # FastAPI app factory, lifespan, CORS, security headers
│   ├── storage/              # uploaded media + transformation outputs (gitignored)
│   ├── tests/e2e.py          # full E2E integration test
│   ├── requirements.txt
│   └── .env.example
│
├── frontend/
│   ├── app/
│   │   ├── (auth)/
│   │   │   ├── layout.tsx    # split editorial auth shell
│   │   │   ├── register/
│   │   │   ├── login/
│   │   │   └── verify/       # legacy route explaining verification is no longer needed
│   │   ├── dashboard/        # stats + recent-uploads grid
│   │   ├── upload/           # drag-and-drop analyzer
│   │   ├── result/[id]/      # ScoreRing + signal breakdown + video timeline
│   │   ├── profile/          # account info + logout-all
│   │   ├── lab/              # style picker + dual consent + output preview
│   │   ├── page.tsx          # landing page
│   │   ├── layout.tsx
│   │   └── globals.css
│   ├── src/
│   │   ├── components/       # Logo, AppShell, ProtectedRoute, VerdictBadge, ScoreRing
│   │   └── lib/              # api client, zustand auth store, utils
│   ├── tailwind.config.ts
│   ├── next.config.js
│   └── package.json
│
└── README.md
```

---

## 4. Backend reference

Base URL: `http://127.0.0.1:8000/api/v1`

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | — | Create account and return JWT immediately. |
| POST | `/auth/verify-otp` | — | Legacy OTP verification endpoint for older accounts. |
| POST | `/auth/resend-otp` | — | Legacy helper that now explains OTP is no longer required. |
| POST | `/auth/login` | — | Email + password → JWT. |
| POST | `/auth/logout` | bearer | Revokes THIS session server-side. |
| POST | `/auth/logout-all` | bearer | Revokes every active session for the user. |
| GET | `/auth/me` | bearer | Current user profile. |

### Media

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/media/upload` | bearer | Multipart: `file` + `consent=true`. Runs analysis synchronously. Returns media + analysis. |
| GET | `/media/` | bearer | Paginated list of user's media with inline analysis. |
| GET | `/media/{id}` | bearer | Single media + analysis. Owner-only. |
| GET | `/media/{id}/file` | bearer | Raw file download. Owner-only. |
| DELETE | `/media/{id}` | bearer | Hard-delete media + on-disk file. |
| GET | `/media/stats/summary` | bearer | `{ total_uploads, total_analyses, likely_ai, likely_real, inconclusive }`. |

### Lab

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/lab/styles` | — | List allowed styles, daily quota, safety policy text. |
| GET | `/lab/quota` | bearer | `{ used, remaining, limit }` for the last 24h. |
| POST | `/lab/transform` | bearer | Multipart: `file` + `style` + `consent_own_media` + `consent_ai_label`. Returns watermarked download URL. |
| GET | `/lab/download/{filename}` | bearer | Fetch a transformation output. Path-guarded, owner-only. |

---

## 5. Frontend reference

The frontend reads one environment variable:

```
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
```

Token handling uses `sessionStorage` (not `localStorage`) so closing the tab invalidates client-side auth immediately. Server-side session revocation via `/auth/logout` means the token also becomes unusable even if someone copied it — the guard in `app/core/deps.py` rejects any JWT whose `jti` hash is marked `revoked=True` in the `user_sessions` table.

Every protected page (`dashboard`, `upload`, `result/[id]`, `profile`, `lab`) is wrapped in `<ProtectedRoute>`, which calls `/auth/me` on mount; if that returns 401, it hard-redirects to `/login`. The back button cannot recover the content because the whole tree is dependent on that auth call, and `Cache-Control: no-store` is set on every authenticated API response.

### Key components

- `AppShell` — topbar with nav, user avatar, and logout
- `ProtectedRoute` — gate + spinner + redirect
- `VerdictBadge` — color-coded tag (green / amber / red)
- `ScoreRing` — animated SVG ring for AI probability
- `Logo` — branded mark

---

## 6. Running & development

### Reset the database

```bash
cd backend
rm -f artframe.db
rm -rf storage
```

Next startup will recreate tables from SQLAlchemy metadata.

### Switch to real email

In `backend/.env`:

```
EMAIL_ENABLED=True
EMAIL_PROVIDER=sendgrid
SENDGRID_API_KEY=your-sendgrid-api-key
EMAIL_FROM=noreply@yourdomain.com
```

`EMAIL_FROM` must be a verified sender in SendGrid. If `EMAIL_ENABLED=False`, or the selected provider is missing required credentials, email delivery falls back to the backend console instead.

### Production notes

The current MVP uses:
- **SQLite** (easy local dev) — swap `DATABASE_URL` to `postgresql+asyncpg://…` for Postgres. Alembic is already in requirements.
- **In-memory rate limiter** — fine for one instance; replace with `redis` for multi-process. The interface is `app/core/ratelimit.py::check_rate`.
- **Synchronous analysis** — upload returns once analysis is done. For large videos, move to Celery (requirements already include Redis-compatible config).
- **Local file storage** — swap `storage/` with S3/MinIO for horizontal scale.

---

## 7. Security model

- **Passwords**: bcrypt with 72-byte truncation guard
- **JWT**: HS256 with per-token `jti` + `exp` + `iat`. Server-side session table (`user_sessions`) records `token_jti` (SHA-256 of the token), revocation flag, IP, user-agent, expiry. Logout sets `revoked=True` server-side, so even a copied token fails.
- **Auth flow**: registration activates the account immediately and returns a JWT + session row
- **Rate limiting**: per-IP per-action sliding window (register 5/min, verify-otp 10/min, login 10/min, resend-otp 3/min)
- **Headers**: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` on every authenticated response
- **Audit log**: every auth action, every upload, every transformation recorded with IP + UA
- **CORS**: explicit allow-list from `.env`
- **File validation**: extension whitelist per media type, 25 MB default cap, per-user folder on disk

### Back-button and logout behavior

When a user clicks logout:

1. `POST /auth/logout` marks the session `revoked=True` in the `user_sessions` table
2. The frontend clears `sessionStorage` and calls `window.location.replace('/login')` — a hard redirect, not a client-side route
3. Pressing the back button may visually restore a stale snapshot, but any API call on that page (including `/auth/me` that `ProtectedRoute` triggers on mount) returns 401 because the session row is marked revoked
4. `ProtectedRoute` immediately redirects the stale view to `/login`

---

## 8. Limits and responsible-use policy

ArtFrame's detection is **decision-support, not proof**. A `likely_ai` verdict means the ensemble of forensic signals agrees the media shows synthetic characteristics — it does **not** constitute court-admissible evidence. Always consider context, source, and corroborating signals.

The Transformation Lab deliberately avoids capabilities that could be used for:

- Identity imitation or impersonation
- Face-swap or voice cloning of real people
- "Deepfake-realistic" output that could be passed off as a real recording

All outputs are **conspicuously** watermarked and labelled `AI-GENERATED`. This is a constraint, not a limitation — it's how we think synthetic-media tools should ship in 2026.

---

## License

MIT · Built by Rayhan as a portfolio and research project · 2026
