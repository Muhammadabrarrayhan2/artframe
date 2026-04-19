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
