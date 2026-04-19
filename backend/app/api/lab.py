"""
Safe Transformation Lab.

Explicit safety posture:
- Only stylized, obviously-artificial transformations are allowed.
- Every output is permanently watermarked with "AI-GENERATED" + user id + timestamp.
- No face-identity transformations, no impersonation, no celebrity filters.
- Daily quota per user to prevent abuse.
- All operations are audit-logged.
"""
from __future__ import annotations
import io
import os
import uuid
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter, ImageOps, ImageDraw, ImageFont
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, Form, status
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.models.audit import AuditLog
from app.services.audit_service import log_action

router = APIRouter(prefix="/lab", tags=["transformation-lab"])

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

DAILY_QUOTA = 10  # transformations per user per day


def _transform_sketch(img: Image.Image) -> Image.Image:
    gray = ImageOps.grayscale(img)
    inv = ImageOps.invert(gray)
    blur = inv.filter(ImageFilter.GaussianBlur(radius=8))
    arr_g = np.asarray(gray, dtype=np.float32)
    arr_b = np.asarray(blur, dtype=np.float32)
    out = np.minimum(arr_g * 255.0 / (255.0 - arr_b + 1e-6), 255).astype(np.uint8)
    result = Image.fromarray(out).convert("RGB")
    return result


def _transform_oil(img: Image.Image) -> Image.Image:
    return img.filter(ImageFilter.ModeFilter(size=7)).filter(ImageFilter.SMOOTH_MORE)


def _transform_watercolor(img: Image.Image) -> Image.Image:
    smoothed = img.filter(ImageFilter.SMOOTH_MORE).filter(ImageFilter.GaussianBlur(radius=2))
    edges = img.filter(ImageFilter.FIND_EDGES).filter(ImageFilter.SMOOTH)
    arr_s = np.asarray(smoothed, dtype=np.float32)
    arr_e = np.asarray(edges, dtype=np.float32)
    out = np.clip(arr_s * 0.85 + arr_e * 0.15, 0, 255).astype(np.uint8)
    return Image.fromarray(out)


def _transform_cyberpunk(img: Image.Image) -> Image.Image:
    arr = np.asarray(img.convert("RGB"), dtype=np.float32)
    # Push magenta/teal
    arr[..., 0] = np.clip(arr[..., 0] * 1.15 + 15, 0, 255)
    arr[..., 2] = np.clip(arr[..., 2] * 1.25 + 20, 0, 255)
    arr[..., 1] = np.clip(arr[..., 1] * 0.75, 0, 255)
    return Image.fromarray(arr.astype(np.uint8))


def _transform_vintage(img: Image.Image) -> Image.Image:
    arr = np.asarray(img.convert("RGB"), dtype=np.float32)
    # Warm sepia
    r = np.clip(arr[..., 0] * 0.9 + arr[..., 1] * 0.35 + arr[..., 2] * 0.18, 0, 255)
    g = np.clip(arr[..., 0] * 0.35 + arr[..., 1] * 0.75 + arr[..., 2] * 0.16, 0, 255)
    b = np.clip(arr[..., 0] * 0.27 + arr[..., 1] * 0.33 + arr[..., 2] * 0.45, 0, 255)
    arr = np.stack([r, g, b], axis=-1).astype(np.uint8)
    return Image.fromarray(arr).filter(ImageFilter.GaussianBlur(0.6))


def _transform_duotone(img: Image.Image) -> Image.Image:
    gray = np.asarray(ImageOps.grayscale(img), dtype=np.float32) / 255.0
    a = np.array([30, 30, 80], dtype=np.float32)
    b = np.array([240, 120, 70], dtype=np.float32)
    out = (gray[..., None] * b + (1 - gray[..., None]) * a).clip(0, 255).astype(np.uint8)
    return Image.fromarray(out)


def _transform_mosaic(img: Image.Image) -> Image.Image:
    small = img.resize((max(1, img.width // 18), max(1, img.height // 18)), Image.Resampling.BILINEAR)
    return small.resize(img.size, Image.Resampling.NEAREST)


def _transform_pixelate(img: Image.Image) -> Image.Image:
    small = img.resize((max(1, img.width // 28), max(1, img.height // 28)), Image.Resampling.NEAREST)
    return small.resize(img.size, Image.Resampling.NEAREST)


def _transform_neon_glow(img: Image.Image) -> Image.Image:
    arr = np.asarray(img.convert("RGB"), dtype=np.float32)
    gray_pil = ImageOps.grayscale(img)
    edges = gray_pil.filter(ImageFilter.FIND_EDGES)
    edges_arr = np.asarray(edges, dtype=np.float32)
    peak = float(np.percentile(edges_arr, 95)) + 1e-6
    e = np.clip(edges_arr / peak, 0.0, 1.0)
    neon = np.zeros_like(arr)
    neon[..., 0] = e * 255 * 0.85
    neon[..., 1] = e * 255 * 0.15
    neon[..., 2] = e * 255 * 1.0
    glow = Image.fromarray(neon.astype(np.uint8)).filter(ImageFilter.GaussianBlur(5))
    glow_arr = np.asarray(glow, dtype=np.float32)
    dark_bg = arr * 0.10
    result = np.clip(dark_bg + neon + glow_arr * 0.65, 0, 255)
    return Image.fromarray(result.astype(np.uint8))


def _transform_anime(img: Image.Image) -> Image.Image:
    from PIL import ImageEnhance
    smooth = img
    for _ in range(4):
        smooth = smooth.filter(ImageFilter.SMOOTH_MORE)
    quantized = smooth.quantize(colors=24).convert("RGB")
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
    lum_mapped = np.clip(lum ** 0.72 * 1.25, 0.0, 1.0)
    blur_arr = np.asarray(
        img.filter(ImageFilter.GaussianBlur(12)).convert("RGB"), dtype=np.float32
    ) / 255.0
    detail = arr - blur_arr * 0.45
    scale = np.where(lum > 1e-6, lum_mapped / (lum + 1e-6), 1.0)[..., None]
    combined = np.clip(arr * scale + detail * 0.38, 0.0, 1.0)
    gray = lum[..., None]
    result = np.clip(gray + (combined - gray) * 1.55, 0.0, 1.0)
    return Image.fromarray((result * 255).astype(np.uint8))


def _transform_pop_art(img: Image.Image) -> Image.Image:
    arr = np.asarray(img.convert("RGB"), dtype=np.uint8)
    levels = 4
    step = 256 // levels
    posterized = ((arr // step) * step + step // 2).astype(np.float32)
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
    result[..., 0] = np.roll(arr[..., 0], shift, axis=1)
    result[..., 2] = np.roll(arr[..., 2], -shift, axis=1)
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
    result[..., 0] = arr[..., 1] * 1.15
    result[..., 1] = arr[..., 0] * 0.85
    result[..., 2] = arr[..., 2] * 0.65
    result = result * 1.18 + 10
    return Image.fromarray(np.clip(result, 0, 255).astype(np.uint8))


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


def _apply_watermark(img: Image.Image, user_id: int) -> Image.Image:
    """Apply a visible watermark across the image so the output can't easily be passed off as real."""
    img = img.convert("RGB").copy()
    draw = ImageDraw.Draw(img, "RGBA")
    W, H = img.size

    # Find a reasonable font
    font_size = max(14, min(W, H) // 32)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", font_size)
    except Exception:
        try:
            font = ImageFont.truetype("DejaVuSans-Bold.ttf", font_size)
        except Exception:
            font = ImageFont.load_default()

    label = f"AI-GENERATED · ArtFrame · u{user_id}"
    # Diagonal tiled watermark
    tile_w, tile_h = max(200, font_size * 18), max(80, font_size * 4)
    for y in range(-H, H * 2, tile_h):
        for x in range(-W, W * 2, tile_w):
            draw.text((x, y), label, fill=(255, 255, 255, 55), font=font)

    # Bottom-right corner badge (opaque)
    badge = "AI-GENERATED"
    bbox = draw.textbbox((0, 0), badge, font=font)
    bw, bh = bbox[2] - bbox[0], bbox[3] - bbox[1]
    pad = font_size // 2
    x0 = W - bw - pad * 3
    y0 = H - bh - pad * 3
    draw.rectangle([x0, y0, W - pad, H - pad], fill=(20, 20, 20, 220))
    draw.text((x0 + pad, y0 + pad // 2), badge, fill=(255, 200, 90, 255), font=font)

    return img


def _output_dir() -> Path:
    p = Path(settings.STORAGE_PATH) / "results"
    p.mkdir(parents=True, exist_ok=True)
    return p


async def _check_quota(db: AsyncSession, user_id: int) -> int:
    """Return how many transformations the user has done in the last 24h."""
    cutoff = datetime.utcnow() - timedelta(hours=24)
    result = await db.execute(
        select(func.count(AuditLog.id)).where(
            AuditLog.user_id == user_id,
            AuditLog.action == "lab_transform",
            AuditLog.created_at >= cutoff,
        )
    )
    return result.scalar_one() or 0


@router.get("/styles")
async def list_styles():
    return {
        "styles": [{"id": k, "name": v} for k, v in ALLOWED_STYLES.items()],
        "daily_quota": DAILY_QUOTA,
        "policy": (
            "All outputs are permanently watermarked. Only stylized, obviously-artificial "
            "effects are supported. Identity impersonation and face-swap are not available."
        ),
    }


@router.get("/quota")
async def get_quota(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    used = await _check_quota(db, user.id)
    return {"used": used, "remaining": max(0, DAILY_QUOTA - used), "limit": DAILY_QUOTA}


@router.post("/transform", status_code=201)
async def transform(
    request: Request,
    file: UploadFile = File(...),
    style: str = Form(...),
    consent_own_media: bool = Form(...),
    consent_ai_label: bool = Form(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not consent_own_media:
        raise HTTPException(400, "You must confirm the media is yours to transform.")
    if not consent_ai_label:
        raise HTTPException(400, "You must acknowledge that the output will be labelled AI-generated.")

    if style not in ALLOWED_STYLES:
        raise HTTPException(400, f"Unsupported style. Allowed: {list(ALLOWED_STYLES.keys())}")

    # Quota
    used = await _check_quota(db, user.id)
    if used >= DAILY_QUOTA:
        raise HTTPException(429, f"Daily transformation quota ({DAILY_QUOTA}) reached. Try again tomorrow.")

    # Only allow images for the MVP lab to keep things safe/simple
    ext = Path(file.filename or "").suffix.lower()
    if ext not in {".jpg", ".jpeg", ".png", ".webp"}:
        raise HTTPException(415, "Lab currently supports image inputs only (jpg/png/webp).")

    # Read & enforce size
    data = await file.read()
    if len(data) > settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024:
        raise HTTPException(413, "File too large")

    try:
        img = Image.open(io.BytesIO(data)).convert("RGB")
        img.load()
    except Exception as e:
        raise HTTPException(400, f"Could not decode image: {e}")

    # Downscale if huge to keep things fast
    MAX_SIDE = 1600
    if max(img.size) > MAX_SIDE:
        ratio = MAX_SIDE / max(img.size)
        img = img.resize((int(img.width * ratio), int(img.height * ratio)), Image.Resampling.LANCZOS)

    transformed = TRANSFORM_FN[style](img)
    watermarked = _apply_watermark(transformed, user.id)

    out_dir = _output_dir() / str(user.id)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_name = f"lab_{uuid.uuid4().hex}.jpg"
    out_path = out_dir / out_name
    # Embed metadata in JPEG comment
    watermarked.save(
        out_path, "JPEG", quality=88,
        comment=f"ArtFrame AI-GENERATED. style={style}. user_id={user.id}. ts={datetime.utcnow().isoformat()}Z".encode(),
    )

    await log_action(db, "lab_transform", user.id, request, {
        "style": style, "output": out_name, "size_kb": os.path.getsize(out_path) // 1024,
    })

    return {
        "message": "Transformation complete",
        "style": style,
        "style_name": ALLOWED_STYLES[style],
        "download_url": f"{settings.API_V1_PREFIX}/lab/download/{out_name}",
        "watermarked": True,
        "remaining_quota": DAILY_QUOTA - used - 1,
    }


@router.get("/download/{filename}")
async def download_result(
    filename: str,
    user: User = Depends(get_current_user),
):
    # Sanitize filename — must be one we generated
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(400, "Invalid filename")
    out_path = _output_dir() / str(user.id) / filename
    if not out_path.exists():
        raise HTTPException(404, "Result not found")
    return FileResponse(out_path, media_type="image/jpeg", filename=filename)
