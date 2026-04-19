# Gemini AI Lab Expansion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 8 new manual image styles, a Gemini AI Generate tab (text-to-image, AI image transform, text-to-video), and global API key config to the ArtFrame Lab.

**Architecture:** Gemini API calls are encapsulated in `GeminiService` (new service). A new `lab_gemini` FastAPI router handles all AI generation endpoints. Existing Lab features are untouched. The frontend gets a 4th "AI Generate" tab that shows a setup banner when the API key is missing.

**Tech Stack:** Python `google-genai` SDK, FastAPI, OpenCV (frame stitching), PIL/NumPy (new filters), Next.js/React, TypeScript.

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Modify | `backend/requirements.txt` | Add `google-genai` |
| Modify | `backend/app/core/config.py` | Add `GEMINI_API_KEY` setting |
| Modify | `backend/.env` | Add `GEMINI_API_KEY=` placeholder |
| Modify | `backend/app/api/lab.py` | Add 8 new image transform functions |
| Create | `backend/app/services/gemini_service.py` | `GeminiService` class (generate_image, transform_image, generate_video_frames) |
| Create | `backend/app/api/lab_gemini.py` | FastAPI router: /status, /quota, /generate-image, /transform-image, /generate-video, /download |
| Modify | `backend/app/main.py` | Register `lab_gemini` router |
| Modify | `frontend/src/lib/api.ts` | Add AI types + api methods |
| Modify | `frontend/app/lab/page.tsx` | Add new STYLE_PREVIEWS, 4th "AI Generate" tab, AiGenerateTab component |

---

## Task 1: Install google-genai dependency

**Files:**
- Modify: `backend/requirements.txt`

- [ ] **Step 1: Add google-genai to requirements.txt**

Open `backend/requirements.txt` and append at the end:
```
google-genai>=0.8.0
```

- [ ] **Step 2: Install the package in the venv**

```bash
cd d:/artframe/backend && venv/Scripts/pip install google-genai
```

Expected output: `Successfully installed google-genai-...`

- [ ] **Step 3: Verify import works**

```bash
cd d:/artframe/backend && venv/Scripts/python -c "from google import genai; print('OK')"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
cd d:/artframe/backend && git add requirements.txt
git commit -m "feat: add google-genai dependency for Gemini AI features"
```

---

## Task 2: Add GEMINI_API_KEY to config and .env

**Files:**
- Modify: `backend/app/core/config.py` (after `EMAIL_FROM` field)
- Modify: `backend/.env`

- [ ] **Step 1: Add GEMINI_API_KEY field to Settings class**

In `backend/app/core/config.py`, add after the `EMAIL_FROM` line:
```python
    GEMINI_API_KEY: str = ""
```

- [ ] **Step 2: Add placeholder to .env**

Open `backend/.env` (create if it doesn't exist) and add:
```
# Gemini AI — get your key at https://aistudio.google.com/app/apikey
GEMINI_API_KEY=
```

- [ ] **Step 3: Verify config loads correctly**

```bash
cd d:/artframe/backend && venv/Scripts/python -c "from app.core.config import settings; print('GEMINI_API_KEY configured:', bool(settings.GEMINI_API_KEY))"
```

Expected: `GEMINI_API_KEY configured: False`

- [ ] **Step 4: Commit**

```bash
cd d:/artframe/backend && git add app/core/config.py .env
git commit -m "feat: add GEMINI_API_KEY config setting"
```

---

## Task 3: Create GeminiService

**Files:**
- Create: `backend/app/services/gemini_service.py`

- [ ] **Step 1: Create gemini_service.py**

Create `backend/app/services/gemini_service.py` with this exact content:

```python
"""
Gemini AI service — wraps google-genai SDK for image generation,
image transformation, and video frame generation.

Usage:
  GeminiService.is_configured()          -> bool
  GeminiService.generate_image(...)      -> bytes (PNG/JPEG)
  GeminiService.transform_image(...)     -> bytes (JPEG)
  GeminiService.generate_video_frames(...)-> list[bytes]
"""
from __future__ import annotations

import io
from PIL import Image


class GeminiService:
    _client = None

    @classmethod
    def _get_client(cls):
        if cls._client is None:
            from app.core.config import settings
            if not settings.GEMINI_API_KEY:
                raise ValueError("GEMINI_API_KEY is not set in .env")
            from google import genai
            cls._client = genai.Client(api_key=settings.GEMINI_API_KEY)
        return cls._client

    @classmethod
    def is_configured(cls) -> bool:
        from app.core.config import settings
        return bool(settings.GEMINI_API_KEY)

    @classmethod
    def generate_image(cls, prompt: str, aspect_ratio: str = "square") -> bytes:
        """
        Generate an image from a text prompt.
        aspect_ratio: "square" | "landscape" | "portrait"
        Returns raw JPEG/PNG bytes.
        """
        from google.genai import types

        client = cls._get_client()
        ar_map = {"square": "1:1", "landscape": "16:9", "portrait": "9:16"}
        ar = ar_map.get(aspect_ratio, "1:1")

        try:
            response = client.models.generate_images(
                model="imagen-3.0-generate-002",
                prompt=prompt,
                config=types.GenerateImagesConfig(
                    number_of_images=1,
                    aspect_ratio=ar,
                    safety_filter_level="BLOCK_MEDIUM_AND_ABOVE",
                ),
            )
            return response.generated_images[0].image.image_bytes
        except Exception:
            # Fallback: gemini-2.0-flash-exp multimodal generation
            response = client.models.generate_content(
                model="gemini-2.0-flash-exp",
                contents=f"Generate a detailed, high-quality image of: {prompt}",
                config=types.GenerateContentConfig(
                    response_modalities=["IMAGE", "TEXT"],
                ),
            )
            for part in response.candidates[0].content.parts:
                if hasattr(part, "inline_data") and part.inline_data:
                    return part.inline_data.data
            raise ValueError("No image returned by Gemini fallback model")

    @classmethod
    def transform_image(cls, image_bytes: bytes, instruction: str) -> bytes:
        """
        Transform an existing image using Gemini vision + generation.
        Returns JPEG bytes of the transformed image.
        """
        from google.genai import types

        client = cls._get_client()

        # Resize to max 1024px to stay within API limits
        img = Image.open(io.BytesIO(image_bytes))
        if max(img.size) > 1024:
            ratio = 1024 / max(img.size)
            img = img.resize((int(img.width * ratio), int(img.height * ratio)))
        buf = io.BytesIO()
        img.convert("RGB").save(buf, "JPEG", quality=85)
        prepared_bytes = buf.getvalue()

        response = client.models.generate_content(
            model="gemini-2.0-flash-exp",
            contents=[
                types.Part.from_bytes(data=prepared_bytes, mime_type="image/jpeg"),
                (
                    f"Transform this image with the following instruction: {instruction}. "
                    "Output only the resulting transformed image. Do not include any text."
                ),
            ],
            config=types.GenerateContentConfig(
                response_modalities=["IMAGE", "TEXT"],
            ),
        )

        for part in response.candidates[0].content.parts:
            if hasattr(part, "inline_data") and part.inline_data:
                return part.inline_data.data
        raise ValueError("No image returned by Gemini for transform request")

    @classmethod
    def generate_video_frames(cls, prompt: str, n_frames: int = 6) -> list[bytes]:
        """
        Generate n_frames images representing a smooth video sequence.
        Returns list of image bytes (one per keyframe).
        Minimum 3 frames returned; raises ValueError if < 3 succeed.
        """
        frames: list[bytes] = []

        for i in range(n_frames):
            position = (
                "at the very beginning" if i == 0
                else "at the very end" if i == n_frames - 1
                else f"at step {i + 1} of {n_frames}"
            )
            frame_prompt = (
                f"{prompt}. "
                f"This is a single animation frame {position} of a smooth {n_frames}-frame sequence. "
                "Maintain consistent style, lighting, and composition across all frames."
            )
            try:
                frame_bytes = cls.generate_image(frame_prompt, "landscape")
                frames.append(frame_bytes)
            except Exception:
                if frames:
                    frames.append(frames[-1])  # duplicate last on error

        if len(frames) < 3:
            raise ValueError(
                f"Only {len(frames)} frames generated (minimum 3 required). "
                "Check your Gemini API quota."
            )
        return frames
```

- [ ] **Step 2: Verify import**

```bash
cd d:/artframe/backend && venv/Scripts/python -c "from app.services.gemini_service import GeminiService; print('configured:', GeminiService.is_configured())"
```

Expected: `configured: False`

- [ ] **Step 3: Commit**

```bash
cd d:/artframe/backend && git add app/services/gemini_service.py
git commit -m "feat: add GeminiService wrapping google-genai SDK"
```

---

## Task 4: Create lab_gemini router

**Files:**
- Create: `backend/app/api/lab_gemini.py`

- [ ] **Step 1: Create lab_gemini.py**

Create `backend/app/api/lab_gemini.py`:

```python
"""
AI Generation Lab — endpoints powered by Gemini API.

GET  /lab-gemini/status           — check if API key is configured
GET  /lab-gemini/quota            — daily AI credits remaining for user
POST /lab-gemini/generate-image   — text-to-image (Imagen 3 / gemini-2.0-flash)
POST /lab-gemini/transform-image  — upload image + instruction → AI transform
POST /lab-gemini/generate-video   — text-to-video (frame generation + OpenCV stitch)
GET  /lab-gemini/download/{file}  — download a previously generated file
"""
from __future__ import annotations

import base64
import io
import uuid
from datetime import datetime, timedelta
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi.responses import FileResponse

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.audit import AuditLog
from app.models.user import User
from app.services.audit_service import log_action
from app.services.gemini_service import GeminiService

router = APIRouter(prefix="/lab-gemini", tags=["lab-gemini"])

AI_DAILY_QUOTA = 10


# ── helpers ──────────────────────────────────────────────────────────────────

def _output_dir() -> Path:
    p = Path(settings.STORAGE_PATH) / "results"
    p.mkdir(parents=True, exist_ok=True)
    return p


async def _check_ai_quota(db: AsyncSession, user_id: int) -> int:
    cutoff = datetime.utcnow() - timedelta(hours=24)
    result = await db.execute(
        select(func.count(AuditLog.id)).where(
            AuditLog.user_id == user_id,
            AuditLog.action == "lab_ai_generate",
            AuditLog.created_at >= cutoff,
        )
    )
    return result.scalar_one() or 0


def _watermark(img: Image.Image, user_id: int) -> Image.Image:
    img = img.convert("RGB").copy()
    draw = ImageDraw.Draw(img, "RGBA")
    W, H = img.size
    font_size = max(14, min(W, H) // 32)
    try:
        font = ImageFont.truetype(
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", font_size
        )
    except Exception:
        font = ImageFont.load_default()
    label = f"AI-GENERATED · ArtFrame · u{user_id}"
    tile_w = max(200, font_size * 18)
    tile_h = max(80, font_size * 4)
    for y in range(-H, H * 2, tile_h):
        for x in range(-W, W * 2, tile_w):
            draw.text((x, y), label, fill=(255, 255, 255, 55), font=font)
    badge = "AI-GENERATED"
    bbox = draw.textbbox((0, 0), badge, font=font)
    bw, bh = bbox[2] - bbox[0], bbox[3] - bbox[1]
    pad = font_size // 2
    x0, y0 = W - bw - pad * 3, H - bh - pad * 3
    draw.rectangle([x0, y0, W - pad, H - pad], fill=(20, 20, 20, 220))
    draw.text((x0 + pad, y0 + pad // 2), badge, fill=(255, 200, 90, 255), font=font)
    return img


def _frames_to_mp4(frame_bytes_list: list[bytes], output_path: str, duration_seconds: int) -> bool:
    """Stitch keyframes into an MP4. Each frame is held for equal duration."""
    frames_cv = []
    for b in frame_bytes_list:
        try:
            img = Image.open(io.BytesIO(b)).convert("RGB").resize((896, 504))
            frames_cv.append(cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR))
        except Exception:
            continue

    if len(frames_cv) < 3:
        return False

    h, w = frames_cv[0].shape[:2]
    fps = 24
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(output_path, fourcc, fps, (w, h))
    total_frames = fps * duration_seconds
    reps = max(1, total_frames // len(frames_cv))

    for frame in frames_cv:
        for _ in range(reps):
            out.write(frame)

    out.release()
    return True


# ── request schemas ───────────────────────────────────────────────────────────

class GenerateImageRequest(BaseModel):
    prompt: str = Field(..., min_length=3, max_length=500)
    aspect_ratio: str = Field("square", pattern="^(square|landscape|portrait)$")


class GenerateVideoRequest(BaseModel):
    prompt: str = Field(..., min_length=3, max_length=300)
    duration_seconds: int = Field(3, ge=3, le=5)


# ── endpoints ─────────────────────────────────────────────────────────────────

@router.get("/status")
async def ai_status():
    """Public — check if Gemini API key is configured."""
    return {
        "configured": GeminiService.is_configured(),
        "model": "gemini-2.0-flash / imagen-3.0-generate-002",
    }


@router.get("/quota")
async def ai_quota(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    used = await _check_ai_quota(db, user.id)
    return {
        "used": used,
        "remaining": max(0, AI_DAILY_QUOTA - used),
        "limit": AI_DAILY_QUOTA,
    }


@router.post("/generate-image", status_code=201)
async def generate_image(
    request: Request,
    body: GenerateImageRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not GeminiService.is_configured():
        raise HTTPException(
            503,
            "AI generation is not configured. "
            "Add GEMINI_API_KEY=your-key to backend/.env and restart the server.",
        )
    used = await _check_ai_quota(db, user.id)
    if used >= AI_DAILY_QUOTA:
        raise HTTPException(429, f"Daily AI credit limit ({AI_DAILY_QUOTA}) reached. Try again tomorrow.")

    try:
        image_bytes = GeminiService.generate_image(body.prompt, body.aspect_ratio)
    except Exception as exc:
        raise HTTPException(503, f"Image generation failed: {exc}")

    img = Image.open(io.BytesIO(image_bytes))
    watermarked = _watermark(img, user.id)

    out_dir = _output_dir() / str(user.id)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_name = f"ai_img_{uuid.uuid4().hex}.jpg"
    out_path = out_dir / out_name
    watermarked.save(out_path, "JPEG", quality=88)
    img_bytes = out_path.read_bytes()

    await log_action(db, "lab_ai_generate", user.id, request, {
        "type": "image", "prompt": body.prompt[:80], "aspect_ratio": body.aspect_ratio,
    })

    return {
        "message": "Image generated",
        "image_base64": base64.b64encode(img_bytes).decode("ascii"),
        "mime_type": "image/jpeg",
        "watermarked": True,
        "download_url": f"{settings.API_V1_PREFIX}/lab-gemini/download/{out_name}",
        "remaining_quota": max(0, AI_DAILY_QUOTA - used - 1),
    }


@router.post("/transform-image", status_code=201)
async def transform_image(
    request: Request,
    file: UploadFile = File(...),
    instruction: str = Form(..., max_length=300),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not GeminiService.is_configured():
        raise HTTPException(503, "AI generation is not configured.")
    used = await _check_ai_quota(db, user.id)
    if used >= AI_DAILY_QUOTA:
        raise HTTPException(429, "Daily AI credit limit reached.")

    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(413, "File too large for AI transform (max 10 MB)")

    try:
        result_bytes = GeminiService.transform_image(data, instruction)
    except Exception as exc:
        raise HTTPException(503, f"AI transform failed: {exc}")

    img = Image.open(io.BytesIO(result_bytes))
    watermarked = _watermark(img, user.id)

    out_dir = _output_dir() / str(user.id)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_name = f"ai_transform_{uuid.uuid4().hex}.jpg"
    out_path = out_dir / out_name
    watermarked.save(out_path, "JPEG", quality=88)
    img_bytes = out_path.read_bytes()

    await log_action(db, "lab_ai_generate", user.id, request, {
        "type": "image_transform", "instruction": instruction[:80],
    })

    return {
        "message": "Image transformed",
        "image_base64": base64.b64encode(img_bytes).decode("ascii"),
        "mime_type": "image/jpeg",
        "watermarked": True,
        "download_url": f"{settings.API_V1_PREFIX}/lab-gemini/download/{out_name}",
        "remaining_quota": max(0, AI_DAILY_QUOTA - used - 1),
    }


@router.post("/generate-video", status_code=201)
async def generate_video(
    request: Request,
    body: GenerateVideoRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not GeminiService.is_configured():
        raise HTTPException(503, "AI generation is not configured.")
    used = await _check_ai_quota(db, user.id)
    if used >= AI_DAILY_QUOTA:
        raise HTTPException(429, "Daily AI credit limit reached.")

    n_frames = 6 if body.duration_seconds == 3 else 10

    try:
        frames = GeminiService.generate_video_frames(body.prompt, n_frames)
    except Exception as exc:
        raise HTTPException(503, f"Video frame generation failed: {exc}")

    out_dir = _output_dir() / str(user.id)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_name = f"ai_video_{uuid.uuid4().hex}.mp4"
    out_path = out_dir / out_name

    if not _frames_to_mp4(frames, str(out_path), body.duration_seconds):
        raise HTTPException(500, "Failed to stitch video frames into MP4")

    video_bytes = out_path.read_bytes()

    await log_action(db, "lab_ai_generate", user.id, request, {
        "type": "video", "prompt": body.prompt[:80],
        "frames": len(frames), "duration_seconds": body.duration_seconds,
    })

    return {
        "message": "Video generated",
        "video_base64": base64.b64encode(video_bytes).decode("ascii"),
        "mime_type": "video/mp4",
        "frames_generated": len(frames),
        "duration_seconds": body.duration_seconds,
        "disclaimer": (
            "Experimental — AI-generated keyframes stitched into video. "
            "Quality is illustrative. Must not be used for deception."
        ),
        "download_url": f"{settings.API_V1_PREFIX}/lab-gemini/download/{out_name}",
        "remaining_quota": max(0, AI_DAILY_QUOTA - used - 1),
    }


@router.get("/download/{filename}")
async def download_ai_result(
    filename: str,
    user: User = Depends(get_current_user),
):
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(400, "Invalid filename")
    out_path = _output_dir() / str(user.id) / filename
    if not out_path.exists():
        raise HTTPException(404, "Result not found")
    media_type = "video/mp4" if filename.endswith(".mp4") else "image/jpeg"
    return FileResponse(out_path, media_type=media_type, filename=filename)
```

- [ ] **Step 2: Verify syntax**

```bash
cd d:/artframe/backend && venv/Scripts/python -c "from app.api.lab_gemini import router; print('router prefix:', router.prefix)"
```

Expected: `router prefix: /lab-gemini`

- [ ] **Step 3: Commit**

```bash
cd d:/artframe/backend && git add app/api/lab_gemini.py
git commit -m "feat: add lab_gemini router with generate-image, transform-image, generate-video"
```

---

## Task 5: Register lab_gemini router in main.py

**Files:**
- Modify: `backend/app/main.py`

- [ ] **Step 1: Add import**

In `backend/app/main.py`, update the import line from:
```python
from app.api import auth, media, lab, lab_advanced
```
to:
```python
from app.api import auth, media, lab, lab_advanced, lab_gemini
```

- [ ] **Step 2: Register router**

After the existing `app.include_router(lab_advanced.router, ...)` line, add:
```python
app.include_router(lab_gemini.router, prefix=settings.API_V1_PREFIX)
```

- [ ] **Step 3: Verify server starts**

```bash
cd d:/artframe/backend && venv/Scripts/python -c "from app.main import app; print('routes:', [r.path for r in app.routes if '/lab-gemini' in getattr(r, 'path', '')])"
```

Expected: list containing `/api/v1/lab-gemini/status`, `/api/v1/lab-gemini/generate-image`, etc.

- [ ] **Step 4: Commit**

```bash
cd d:/artframe/backend && git add app/main.py
git commit -m "feat: register lab_gemini router"
```

---

## Task 6: Add 8 new image styles to lab.py

**Files:**
- Modify: `backend/app/api/lab.py`

- [ ] **Step 1: Add the 8 transform functions**

In `backend/app/api/lab.py`, after the `_transform_pixelate` function and before `TRANSFORM_FN`, add these 8 functions:

```python
def _transform_neon_glow(img: Image.Image) -> Image.Image:
    arr = np.asarray(img.convert("RGB"), dtype=np.float32)
    gray_pil = ImageOps.grayscale(img)
    edges = gray_pil.filter(ImageFilter.FIND_EDGES)
    edges_arr = np.asarray(edges, dtype=np.float32)
    peak = float(np.percentile(edges_arr, 95)) + 1e-6
    e = np.clip(edges_arr / peak, 0.0, 1.0)
    neon = np.zeros_like(arr)
    neon[..., 0] = e * 255 * 0.85   # R – magenta tint
    neon[..., 1] = e * 255 * 0.15   # G – low
    neon[..., 2] = e * 255 * 1.0    # B – cyan/blue
    glow = Image.fromarray(neon.astype(np.uint8)).filter(ImageFilter.GaussianBlur(5))
    glow_arr = np.asarray(glow, dtype=np.float32)
    dark_bg = arr * 0.10
    result = np.clip(dark_bg + neon + glow_arr * 0.65, 0, 255)
    return Image.fromarray(result.astype(np.uint8))


def _transform_anime(img: Image.Image) -> Image.Image:
    smooth = img
    for _ in range(4):
        smooth = smooth.filter(ImageFilter.SMOOTH_MORE)
    quantized = smooth.quantize(colors=24).convert("RGB")
    from PIL import ImageEnhance
    saturated = ImageEnhance.Color(quantized).enhance(1.8)
    q_arr = np.asarray(saturated, dtype=np.float32)
    gray = ImageOps.grayscale(img)
    edges = gray.filter(ImageFilter.FIND_EDGES)
    edges_arr = np.asarray(edges, dtype=np.float32)
    peak = float(np.percentile(edges_arr, 88)) + 1e-6
    e = np.clip(edges_arr / peak, 0.0, 1.0)
    result = q_arr * (1.0 - e[..., None] * 0.88)
    return Image.fromarray(np.clip(result, 0, 255).astype(np.uint8))


def _transform_hdr(img: Image.Image) -> Image.Image:
    arr = np.asarray(img.convert("RGB"), dtype=np.float32) / 255.0
    lum = 0.299 * arr[..., 0] + 0.587 * arr[..., 1] + 0.114 * arr[..., 2]
    # Gamma compression for tonemapping
    lum_mapped = np.clip(lum ** 0.72 * 1.25, 0.0, 1.0)
    # Local contrast boost via unsharp approach
    blur_arr = np.asarray(
        img.filter(ImageFilter.GaussianBlur(12)).convert("RGB"), dtype=np.float32
    ) / 255.0
    detail = arr - blur_arr * 0.45
    scale = np.where(lum > 1e-6, lum_mapped / (lum + 1e-6), 1.0)[..., None]
    combined = np.clip(arr * scale + detail * 0.38, 0.0, 1.0)
    # Saturation boost
    gray = lum[..., None]
    result = np.clip(gray + (combined - gray) * 1.55, 0.0, 1.0)
    return Image.fromarray((result * 255).astype(np.uint8))


def _transform_pop_art(img: Image.Image) -> Image.Image:
    arr = np.asarray(img.convert("RGB"), dtype=np.uint8)
    levels = 4
    step = 256 // levels
    posterized = ((arr // step) * step + step // 2).astype(np.float32)
    # Per-pixel: push each channel toward 0 or 255 based on whether it dominates
    max_c = posterized.max(axis=2, keepdims=True)
    min_c = posterized.min(axis=2, keepdims=True)
    rng = max_c - min_c + 1e-6
    normalized = (posterized - min_c) / rng
    bold = np.where(normalized > 0.55, 240.0, 20.0)
    result = posterized * 0.35 + bold * 0.65
    return Image.fromarray(np.clip(result, 0, 255).astype(np.uint8))


def _transform_glitch(img: Image.Image) -> Image.Image:
    arr = np.asarray(img.convert("RGB"), dtype=np.float32)
    h, w = arr.shape[:2]
    result = arr.copy()
    shift = max(8, w // 36)
    result[..., 0] = np.roll(arr[..., 0], shift, axis=1)    # R shift right
    result[..., 2] = np.roll(arr[..., 2], -shift, axis=1)   # B shift left
    rng = np.random.default_rng(42)
    n_slices = max(5, h // 28)
    for _ in range(n_slices):
        y0 = int(rng.integers(0, h))
        hs = int(rng.integers(2, max(3, h // 18)))
        xs = int(rng.integers(-w // 7, w // 7))
        y1 = min(h, y0 + hs)
        result[y0:y1] = np.roll(result[y0:y1], xs, axis=1)
    return Image.fromarray(np.clip(result, 0, 255).astype(np.uint8))


def _transform_thermal(img: Image.Image) -> Image.Image:
    gray = np.asarray(ImageOps.grayscale(img), dtype=np.float32) / 255.0
    # Jet colormap approximation: 0→blue, 0.25→cyan, 0.5→green, 0.75→yellow, 1→red
    r = np.clip(1.5 - np.abs(4.0 * gray - 3.0), 0.0, 1.0)
    g = np.clip(1.5 - np.abs(4.0 * gray - 2.0), 0.0, 1.0)
    b = np.clip(1.5 - np.abs(4.0 * gray - 1.0), 0.0, 1.0)
    thermal = np.stack([r, g, b], axis=2)
    return Image.fromarray((thermal * 255).astype(np.uint8))


def _transform_blueprint(img: Image.Image) -> Image.Image:
    gray = ImageOps.grayscale(img)
    edges = gray.filter(ImageFilter.FIND_EDGES).filter(ImageFilter.SMOOTH)
    edges_arr = np.asarray(edges, dtype=np.float32)
    peak = float(np.percentile(edges_arr, 88)) + 1e-6
    e = np.clip(edges_arr / peak, 0.0, 1.0)
    bg = np.array([12, 28, 78], dtype=np.float32)
    line = np.array([100, 195, 255], dtype=np.float32)
    result = bg[None, None, :] + e[..., None] * (line - bg)[None, None, :]
    return Image.fromarray(np.clip(result, 0, 255).astype(np.uint8))


def _transform_infrared(img: Image.Image) -> Image.Image:
    arr = np.asarray(img.convert("RGB"), dtype=np.float32)
    result = arr.copy()
    result[..., 0] = arr[..., 1] * 1.15   # R ← boosted G (foliage glows)
    result[..., 1] = arr[..., 0] * 0.85   # G ← dimmed R
    result[..., 2] = arr[..., 2] * 0.65   # B stays, slightly muted
    result = result * 1.18 + 10            # overall brightness lift
    return Image.fromarray(np.clip(result, 0, 255).astype(np.uint8))
```

- [ ] **Step 2: Update ALLOWED_STYLES dict**

Replace the existing `ALLOWED_STYLES` dict with:
```python
ALLOWED_STYLES = {
    "sketch": "Pencil sketch effect",
    "oil_painting": "Oil painting simulation",
    "watercolor": "Watercolor wash",
    "cyberpunk": "Cyberpunk tint",
    "vintage": "Vintage film tone",
    "duotone": "Two-tone poster effect",
    "mosaic": "Geometric mosaic",
    "pixelate": "Pixelated stylization",
    "neon_glow": "Neon glow",
    "anime": "Anime style",
    "hdr": "HDR effect",
    "pop_art": "Pop art",
    "glitch": "Glitch art",
    "thermal": "Thermal vision",
    "blueprint": "Blueprint",
    "infrared": "Infrared",
}
```

- [ ] **Step 3: Update TRANSFORM_FN dict**

Replace the existing `TRANSFORM_FN` dict with:
```python
TRANSFORM_FN = {
    "sketch": _transform_sketch,
    "oil_painting": _transform_oil,
    "watercolor": _transform_watercolor,
    "cyberpunk": _transform_cyberpunk,
    "vintage": _transform_vintage,
    "duotone": _transform_duotone,
    "mosaic": _transform_mosaic,
    "pixelate": _transform_pixelate,
    "neon_glow": _transform_neon_glow,
    "anime": _transform_anime,
    "hdr": _transform_hdr,
    "pop_art": _transform_pop_art,
    "glitch": _transform_glitch,
    "thermal": _transform_thermal,
    "blueprint": _transform_blueprint,
    "infrared": _transform_infrared,
}
```

- [ ] **Step 4: Verify import**

```bash
cd d:/artframe/backend && venv/Scripts/python -c "from app.api.lab import ALLOWED_STYLES; print(len(ALLOWED_STYLES), 'styles')"
```

Expected: `16 styles`

- [ ] **Step 5: Commit**

```bash
cd d:/artframe/backend && git add app/api/lab.py
git commit -m "feat: add 8 new image style filters (neon, anime, HDR, pop art, glitch, thermal, blueprint, infrared)"
```

---

## Task 7: Update frontend api.ts with AI types and methods

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Add new types at the end of api.ts**

Append these types to `frontend/src/lib/api.ts`:

```typescript
export type AiStatusOut = {
  configured: boolean;
  model: string;
};

export type AiQuotaOut = {
  used: number;
  remaining: number;
  limit: number;
};

export type AiGenerateImageOut = {
  message: string;
  image_base64: string;
  mime_type: string;
  watermarked: boolean;
  download_url: string;
  remaining_quota: number;
};

export type AiGenerateVideoOut = {
  message: string;
  video_base64: string;
  mime_type: string;
  frames_generated: number;
  duration_seconds: number;
  disclaimer: string;
  download_url: string;
  remaining_quota: number;
};
```

- [ ] **Step 2: Add AI methods to the api object**

Inside the `api = { ... }` object in `frontend/src/lib/api.ts`, add these methods after the `videoPresets` method:

```typescript
  // --- Lab Gemini ---
  aiStatus: () => request<AiStatusOut>("/lab-gemini/status", { auth: false }),

  aiQuota: () => request<AiQuotaOut>("/lab-gemini/quota"),

  aiGenerateImage: (prompt: string, aspectRatio: string) =>
    request<AiGenerateImageOut>("/lab-gemini/generate-image", {
      method: "POST",
      body: { prompt, aspect_ratio: aspectRatio },
    }),

  aiTransformImage: (file: File, instruction: string) => {
    const form = new FormData();
    form.append("file", file);
    form.append("instruction", instruction);
    return request<AiGenerateImageOut>("/lab-gemini/transform-image", { method: "POST", form });
  },

  aiGenerateVideo: (prompt: string, durationSeconds: number) =>
    request<AiGenerateVideoOut>("/lab-gemini/generate-video", {
      method: "POST",
      body: { prompt, duration_seconds: durationSeconds },
    }),
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd d:/artframe/frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors (or only pre-existing unrelated errors)

- [ ] **Step 4: Commit**

```bash
cd d:/artframe/frontend && git add src/lib/api.ts
git commit -m "feat: add Gemini AI types and api methods"
```

---

## Task 8: Update lab/page.tsx — new style previews + AiGenerateTab

**Files:**
- Modify: `frontend/app/lab/page.tsx`

- [ ] **Step 1: Add new STYLE_PREVIEWS entries**

In `frontend/app/lab/page.tsx`, extend the `STYLE_PREVIEWS` object with the 8 new styles:

```typescript
const STYLE_PREVIEWS: Record<string, string> = {
  sketch: "linear-gradient(135deg, #f3f1ea 0%, #a8a59b 100%)",
  oil_painting: "linear-gradient(135deg, #8c5f21 0%, #e8a54b 50%, #6b4a1a 100%)",
  watercolor: "linear-gradient(135deg, #6a9bb5 0%, #f0d2a4 100%)",
  cyberpunk: "linear-gradient(135deg, #1a0a3d 0%, #e63c8a 50%, #0fe3c6 100%)",
  vintage: "linear-gradient(135deg, #4a3422 0%, #b8805c 100%)",
  duotone: "linear-gradient(135deg, #1e1e50 0%, #f07846 100%)",
  mosaic: "conic-gradient(from 0deg, #e8a54b, #e8663c, #7dc47a, #3a6db7, #e8a54b)",
  pixelate: "repeating-linear-gradient(45deg, #e8a54b 0 12px, #17171a 12px 24px)",
  neon_glow: "linear-gradient(135deg, #0a0a1a 0%, #8b00ff 40%, #00ffff 100%)",
  anime: "linear-gradient(135deg, #ff6bb5 0%, #ffe066 50%, #6bdfff 100%)",
  hdr: "linear-gradient(135deg, #0d0d0d 0%, #ff6600 50%, #ffffff 100%)",
  pop_art: "linear-gradient(135deg, #ff0080 0%, #ffff00 50%, #00ccff 100%)",
  glitch: "linear-gradient(135deg, #ff003c 0%, #00ff9f 50%, #0033ff 100%)",
  thermal: "linear-gradient(135deg, #0000ff 0%, #00ff00 40%, #ff0000 100%)",
  blueprint: "linear-gradient(135deg, #0c1c4e 0%, #1a5276 50%, #64c8ff 100%)",
  infrared: "linear-gradient(135deg, #1a4a1a 0%, #e8ffe8 50%, #ff8c00 100%)",
};
```

- [ ] **Step 2: Add Sparkles to the import list and add Cpu icon**

Update the lucide-react import in `frontend/app/lab/page.tsx`:

```typescript
import { Wand2, UploadCloud, X, Loader2, Download, ShieldCheck, AlertTriangle, Sparkles, Mic, Video, Cpu, ImageIcon, ChevronDown, ChevronUp } from "lucide-react";
```

- [ ] **Step 3: Add "AI Generate" tab button**

In `LabInner()`, update the tab state type and add the 4th tab button. Replace:
```typescript
const [activeTab, setActiveTab] = useState<"image" | "voice" | "video">("image");
```
with:
```typescript
const [activeTab, setActiveTab] = useState<"image" | "voice" | "video" | "ai">("image");
```

Add the 4th tab button after the Video Transform button:
```tsx
<button
  onClick={() => setActiveTab("ai")}
  className={cn(
    "px-4 py-3 text-sm font-medium transition-all border-b-2 -mb-px",
    activeTab === "ai"
      ? "text-accent-amber border-accent-amber"
      : "text-ink-tertiary border-transparent hover:text-ink-secondary"
  )}
>
  <Cpu className="h-4 w-4 inline mr-2" />
  AI Generate
</button>
```

And add the tab content render:
```tsx
{activeTab === "ai" && <AiGenerateTab />}
```

- [ ] **Step 4: Add the AiGenerateTab component**

Add this full component at the end of `frontend/app/lab/page.tsx`, before the closing of the file:

```tsx
function AiGenerateTab() {
  const [status, setStatus] = useState<{ configured: boolean; model: string } | null>(null);
  const [quota, setQuota] = useState<{ used: number; remaining: number; limit: number } | null>(null);
  const [openSection, setOpenSection] = useState<"image" | "transform" | "video" | null>("image");

  useEffect(() => {
    (async () => {
      try {
        const [s, q] = await Promise.all([api.aiStatus(), api.aiQuota()]);
        setStatus(s);
        setQuota(q);
      } catch {
        const s = await api.aiStatus().catch(() => ({ configured: false, model: "" }));
        setStatus(s);
      }
    })();
  }, []);

  if (status === null) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-ink-tertiary" />
      </div>
    );
  }

  if (!status.configured) {
    return (
      <div className="card p-8 max-w-2xl mx-auto text-center space-y-4">
        <AlertTriangle className="h-10 w-10 text-accent-amber mx-auto" strokeWidth={1.5} />
        <h2 className="text-xl font-semibold text-ink-primary">AI Generation Not Configured</h2>
        <p className="text-sm text-ink-secondary leading-relaxed">
          To enable AI image and video generation, add your Gemini API key to the backend:
        </p>
        <div className="rounded-lg bg-bg-inset p-4 text-left font-mono text-xs text-ink-secondary">
          <div className="text-ink-tertiary mb-1"># backend/.env</div>
          <div className="text-accent-amber">GEMINI_API_KEY=your-key-here</div>
        </div>
        <p className="text-xs text-ink-tertiary">
          Then restart the backend server.{" "}
          <a
            href="https://aistudio.google.com/app/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-ink-primary"
          >
            Get your free key at aistudio.google.com
          </a>
        </p>
      </div>
    );
  }

  const toggleSection = (s: "image" | "transform" | "video") =>
    setOpenSection((prev) => (prev === s ? null : s));

  const onQuotaUsed = () => {
    api.aiQuota().then(setQuota).catch(() => undefined);
  };

  return (
    <div className="space-y-4 max-w-4xl">
      {/* Quota */}
      {quota && (
        <div className="flex items-center justify-end gap-2 text-xs text-ink-tertiary">
          <Cpu className="h-3.5 w-3.5" strokeWidth={1.5} />
          <span>
            AI credits: <span className={quota.remaining === 0 ? "text-signal-ai" : "text-accent-amber"}>{quota.remaining}/{quota.limit}</span> remaining today
          </span>
        </div>
      )}

      {/* Section 1: Text-to-Image */}
      <div className="card overflow-hidden">
        <button
          onClick={() => toggleSection("image")}
          className="w-full flex items-center justify-between p-5 text-left hover:bg-bg-surface/30 transition-colors"
        >
          <div className="flex items-center gap-3">
            <ImageIcon className="h-4 w-4 text-accent-amber" strokeWidth={1.5} />
            <span className="font-medium text-ink-primary">Text-to-Image</span>
            <span className="text-xs text-ink-tertiary">Generate any image from a prompt</span>
          </div>
          {openSection === "image" ? <ChevronUp className="h-4 w-4 text-ink-tertiary" /> : <ChevronDown className="h-4 w-4 text-ink-tertiary" />}
        </button>
        {openSection === "image" && (
          <div className="border-t border-border-subtle p-5">
            <TextToImageSection onQuotaUsed={onQuotaUsed} quotaRemaining={quota?.remaining ?? 0} />
          </div>
        )}
      </div>

      {/* Section 2: AI Image Transform */}
      <div className="card overflow-hidden">
        <button
          onClick={() => toggleSection("transform")}
          className="w-full flex items-center justify-between p-5 text-left hover:bg-bg-surface/30 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Wand2 className="h-4 w-4 text-accent-amber" strokeWidth={1.5} />
            <span className="font-medium text-ink-primary">AI Image Transform</span>
            <span className="text-xs text-ink-tertiary">Upload an image + describe the change</span>
          </div>
          {openSection === "transform" ? <ChevronUp className="h-4 w-4 text-ink-tertiary" /> : <ChevronDown className="h-4 w-4 text-ink-tertiary" />}
        </button>
        {openSection === "transform" && (
          <div className="border-t border-border-subtle p-5">
            <AiImageTransformSection onQuotaUsed={onQuotaUsed} quotaRemaining={quota?.remaining ?? 0} />
          </div>
        )}
      </div>

      {/* Section 3: Text-to-Video */}
      <div className="card overflow-hidden">
        <button
          onClick={() => toggleSection("video")}
          className="w-full flex items-center justify-between p-5 text-left hover:bg-bg-surface/30 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Video className="h-4 w-4 text-accent-amber" strokeWidth={1.5} />
            <span className="font-medium text-ink-primary">Text-to-Video</span>
            <span className="text-xs text-ink-tertiary">Generate a short video from a prompt — 1 attempt per session</span>
          </div>
          {openSection === "video" ? <ChevronUp className="h-4 w-4 text-ink-tertiary" /> : <ChevronDown className="h-4 w-4 text-ink-tertiary" />}
        </button>
        {openSection === "video" && (
          <div className="border-t border-border-subtle p-5">
            <TextToVideoSection onQuotaUsed={onQuotaUsed} quotaRemaining={quota?.remaining ?? 0} />
          </div>
        )}
      </div>
    </div>
  );
}

function TextToImageSection({ onQuotaUsed, quotaRemaining }: { onQuotaUsed: () => void; quotaRemaining: number }) {
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState<"square" | "landscape" | "portrait">("square");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ blob: Blob } | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  useEffect(() => {
    if (result?.blob) {
      const url = URL.createObjectURL(result.blob);
      setResultUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [result?.blob]);

  const generate = async () => {
    if (!prompt.trim()) { toast.error("Enter a prompt first"); return; }
    if (quotaRemaining <= 0) { toast.error("No AI credits remaining today"); return; }
    setLoading(true);
    try {
      const res = await api.aiGenerateImage(prompt.trim(), aspect);
      const binary = atob(res.image_base64);
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: res.mime_type });
      setResult({ blob });
      onQuotaUsed();
      toast.success("Image generated");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail : "Generation failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={500}
          rows={4}
          placeholder="A serene Japanese garden at sunset, cherry blossoms falling..."
          className="w-full rounded-lg border border-border bg-bg-inset px-4 py-3 text-sm text-ink-primary placeholder:text-ink-tertiary focus:outline-none focus:border-accent-amber resize-none"
        />
        <div className="text-xs text-ink-tertiary text-right">{prompt.length}/500</div>
        <div>
          <div className="label mb-2">Aspect ratio</div>
          <div className="flex gap-2">
            {(["square", "landscape", "portrait"] as const).map((a) => (
              <button
                key={a}
                onClick={() => setAspect(a)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium border transition-all capitalize",
                  aspect === a
                    ? "border-accent-amber text-accent-amber bg-accent-amber/10"
                    : "border-border text-ink-tertiary hover:border-border-strong"
                )}
              >
                {a}
              </button>
            ))}
          </div>
        </div>
        <button onClick={generate} disabled={loading || !prompt.trim()} className="btn-primary w-full">
          {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating...</> : <><Sparkles className="h-4 w-4" /> Generate Image</>}
        </button>
      </div>
      <div className="card-elevated p-4 min-h-[220px] flex flex-col">
        {result && resultUrl ? (
          <>
            <img src={resultUrl} alt="Generated" className="w-full rounded-md object-contain mb-3 flex-1" />
            <a href={resultUrl} download="artframe-ai-image.jpg" className="btn-primary w-full text-sm">
              <Download className="h-4 w-4" /> Download
            </a>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center border-2 border-dashed border-border-subtle rounded-md py-8">
            <Sparkles className="h-8 w-8 text-ink-tertiary mb-3" strokeWidth={1} />
            <div className="text-sm text-ink-secondary">Output appears here</div>
          </div>
        )}
      </div>
    </div>
  );
}

function AiImageTransformSection({ onQuotaUsed, quotaRemaining }: { onQuotaUsed: () => void; quotaRemaining: number }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ blob: Blob } | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  useEffect(() => {
    if (result?.blob) {
      const url = URL.createObjectURL(result.blob);
      setResultUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [result?.blob]);

  const acceptFile = (f: File) => {
    if (!f.type.startsWith("image/")) { toast.error("Images only"); return; }
    if (f.size > 10 * 1024 * 1024) { toast.error("Max 10 MB"); return; }
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setResult(null);
  };

  const transform = async () => {
    if (!file || !instruction.trim()) { toast.error("Upload an image and describe the transformation"); return; }
    if (quotaRemaining <= 0) { toast.error("No AI credits remaining today"); return; }
    setLoading(true);
    try {
      const res = await api.aiTransformImage(file, instruction.trim());
      const binary = atob(res.image_base64);
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      setResult({ blob: new Blob([bytes], { type: res.mime_type }) });
      onQuotaUsed();
      toast.success("Image transformed by AI");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail : "Transform failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <div
          onClick={() => !file && inputRef.current?.click()}
          className={cn("border-2 border-dashed rounded-xl transition-all cursor-pointer", file ? "p-4" : "p-8 text-center hover:border-border-strong")}
        >
          <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) acceptFile(f); }} />
          {file && preview ? (
            <div className="flex items-center gap-3">
              <img src={preview} alt="" className="w-16 h-16 object-cover rounded" />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-ink-primary truncate">{file.name}</div>
              </div>
              <button onClick={(e) => { e.stopPropagation(); setFile(null); setPreview(null); setResult(null); }} className="text-ink-tertiary hover:text-ink-primary">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <>
              <UploadCloud className="h-7 w-7 text-accent-amber mx-auto mb-2" strokeWidth={1.5} />
              <div className="text-sm text-ink-primary font-medium">Upload an image</div>
              <div className="text-xs text-ink-tertiary mt-1">jpg/png/webp up to 10 MB</div>
            </>
          )}
        </div>
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          maxLength={300}
          rows={3}
          placeholder='e.g. "make it look like a Van Gogh painting" or "transform into cyberpunk style"'
          className="w-full rounded-lg border border-border bg-bg-inset px-4 py-3 text-sm text-ink-primary placeholder:text-ink-tertiary focus:outline-none focus:border-accent-amber resize-none"
        />
        <div className="text-xs text-ink-tertiary text-right">{instruction.length}/300</div>
        <button onClick={transform} disabled={loading || !file || !instruction.trim()} className="btn-primary w-full">
          {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Transforming...</> : <><Wand2 className="h-4 w-4" /> Transform with AI</>}
        </button>
      </div>
      <div className="card-elevated p-4 min-h-[220px] flex flex-col">
        {result && resultUrl ? (
          <>
            <img src={resultUrl} alt="Transformed" className="w-full rounded-md object-contain mb-3 flex-1" />
            <a href={resultUrl} download="artframe-ai-transform.jpg" className="btn-primary w-full text-sm">
              <Download className="h-4 w-4" /> Download
            </a>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center border-2 border-dashed border-border-subtle rounded-md py-8">
            <Wand2 className="h-8 w-8 text-ink-tertiary mb-3" strokeWidth={1} />
            <div className="text-sm text-ink-secondary">Transformed image appears here</div>
          </div>
        )}
      </div>
    </div>
  );
}

function TextToVideoSection({ onQuotaUsed, quotaRemaining }: { onQuotaUsed: () => void; quotaRemaining: number }) {
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState<3 | 5>(3);
  const [loading, setLoading] = useState(false);
  const [hasAttempted, setHasAttempted] = useState(false);
  const [result, setResult] = useState<{ blob: Blob; disclaimer: string; frames: number } | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  useEffect(() => {
    if (result?.blob) {
      const url = URL.createObjectURL(result.blob);
      setResultUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [result?.blob]);

  const generate = async () => {
    if (!prompt.trim()) { toast.error("Enter a prompt first"); return; }
    if (quotaRemaining <= 0) { toast.error("No AI credits remaining today"); return; }
    setHasAttempted(true);
    setLoading(true);
    try {
      const res = await api.aiGenerateVideo(prompt.trim(), duration);
      const binary = atob(res.video_base64);
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      setResult({ blob: new Blob([bytes], { type: res.mime_type }), disclaimer: res.disclaimer, frames: res.frames_generated });
      onQuotaUsed();
      toast.success(`Video generated — ${res.frames_generated} frames`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail : "Video generation failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <div className="rounded-lg border border-accent-amber/30 bg-accent-amber/5 p-3 text-xs text-ink-secondary flex gap-2">
          <AlertTriangle className="h-4 w-4 text-accent-amber shrink-0 mt-0.5" strokeWidth={1.5} />
          <span>Experimental feature. Each attempt uses multiple AI credits. Limited to 1 attempt per session.</span>
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={300}
          rows={4}
          disabled={hasAttempted}
          placeholder="A time-lapse of a flower blooming in a sunlit meadow..."
          className="w-full rounded-lg border border-border bg-bg-inset px-4 py-3 text-sm text-ink-primary placeholder:text-ink-tertiary focus:outline-none focus:border-accent-amber resize-none disabled:opacity-50"
        />
        <div className="text-xs text-ink-tertiary text-right">{prompt.length}/300</div>
        <div>
          <div className="label mb-2">Duration</div>
          <div className="flex gap-2">
            {([3, 5] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDuration(d)}
                disabled={hasAttempted}
                className={cn(
                  "px-4 py-1.5 rounded-md text-xs font-medium border transition-all",
                  duration === d ? "border-accent-amber text-accent-amber bg-accent-amber/10" : "border-border text-ink-tertiary hover:border-border-strong",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              >
                {d}s
              </button>
            ))}
          </div>
        </div>
        <button onClick={generate} disabled={loading || !prompt.trim() || hasAttempted} className="btn-primary w-full">
          {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating {duration}s video...</> : <><Video className="h-4 w-4" /> Generate Video</>}
        </button>
        {hasAttempted && !loading && (
          <p className="text-xs text-ink-tertiary text-center">
            1-attempt limit reached. Reload the page to try again with a new prompt.
          </p>
        )}
      </div>
      <div className="card-elevated p-4 min-h-[220px] flex flex-col">
        {result && resultUrl ? (
          <>
            <video src={resultUrl} controls className="w-full rounded-md bg-black mb-3 flex-1" />
            <div className="text-xs text-ink-tertiary mb-3">{result.disclaimer}</div>
            <a href={resultUrl} download="artframe-ai-video.mp4" className="btn-primary w-full text-sm">
              <Download className="h-4 w-4" /> Download
            </a>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center border-2 border-dashed border-border-subtle rounded-md py-8">
            <Video className="h-8 w-8 text-ink-tertiary mb-3" strokeWidth={1} />
            <div className="text-sm text-ink-secondary">Generated video appears here</div>
            <div className="text-xs text-ink-tertiary mt-1 px-4">AI generates keyframes, stitched into MP4</div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Verify Next.js builds without errors**

```bash
cd d:/artframe/frontend && npx next build 2>&1 | tail -20
```

Expected: `✓ Compiled successfully` or similar (no TypeScript errors)

- [ ] **Step 6: Commit**

```bash
cd d:/artframe/frontend && git add app/lab/page.tsx src/lib/api.ts
git commit -m "feat: add AI Generate tab with text-to-image, AI transform, text-to-video + 8 new image styles"
```

---

## Task 9: End-to-end verification

- [ ] **Step 1: Start backend**

```bash
cd d:/artframe/backend && venv/Scripts/python run.py
```

- [ ] **Step 2: Verify all new endpoints are listed**

```bash
curl http://127.0.0.1:8000/docs 2>/dev/null | grep -c "lab-gemini" || echo "check /docs manually"
```

Open `http://127.0.0.1:8000/docs` and verify these routes exist under `lab-gemini`:
- `GET /api/v1/lab-gemini/status`
- `GET /api/v1/lab-gemini/quota`
- `POST /api/v1/lab-gemini/generate-image`
- `POST /api/v1/lab-gemini/transform-image`
- `POST /api/v1/lab-gemini/generate-video`

- [ ] **Step 3: Verify status returns configured: false (no key yet)**

```bash
curl http://127.0.0.1:8000/api/v1/lab-gemini/status
```

Expected: `{"configured":false,"model":"gemini-2.0-flash / imagen-3.0-generate-002"}`

- [ ] **Step 4: Start frontend and check Lab page**

```bash
cd d:/artframe/frontend && npm run dev
```

Open `http://localhost:3000/lab`:
- Image tab should show 16 style cards (8 original + 8 new)
- New "AI Generate" tab should show the setup banner (no key configured)

- [ ] **Step 5: Add your Gemini API key and test generation**

Edit `backend/.env`:
```
GEMINI_API_KEY=AIza...your-actual-key
```

Restart backend, open Lab → AI Generate tab:
- Should show quota badge and 3 accordion sections
- Test text-to-image with a simple prompt
- Verify watermark appears on downloaded image

- [ ] **Step 6: Final commit**

```bash
cd d:/artframe && git add -A
git commit -m "feat: complete Gemini AI Lab expansion — image styles, text-to-image, AI transform, text-to-video"
```
