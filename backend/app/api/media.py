import os
import uuid
import mimetypes
from pathlib import Path
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Request, status
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.core.database import get_db
from app.core.config import settings
from app.core.deps import get_current_user
from app.models.user import User
from app.models.media import MediaFile
from app.models.analysis import AnalysisResult
from app.schemas.media import MediaOut, AnalysisOut, MediaWithAnalysisOut, StatsOut
from app.services.audit_service import log_action

from app.ml.image_detector import analyze_image
from app.ml.audio_detector import analyze_audio
from app.ml.video_detector import analyze_video

router = APIRouter(prefix="/media", tags=["media"])

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff"}
VIDEO_EXT = {".mp4", ".mov", ".webm", ".mkv", ".avi"}
AUDIO_EXT = {".wav", ".mp3", ".m4a", ".ogg", ".flac"}


def _detect_media_type(filename: str) -> str | None:
    ext = Path(filename).suffix.lower()
    if ext in IMAGE_EXT:
        return "image"
    if ext in VIDEO_EXT:
        return "video"
    if ext in AUDIO_EXT:
        return "audio"
    return None


def _storage_root() -> Path:
    root = Path(settings.STORAGE_PATH) / "uploads"
    root.mkdir(parents=True, exist_ok=True)
    return root


@router.post("/upload", response_model=MediaWithAnalysisOut, status_code=201)
async def upload_media(
    request: Request,
    file: UploadFile = File(...),
    consent: bool = Form(..., description="User confirms they own or have rights to this media"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not consent:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You must confirm consent to analyze media.")

    media_type = _detect_media_type(file.filename or "")
    if not media_type:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Unsupported file type")

    # Size guard — read in chunks
    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    user_dir = _storage_root() / str(user.id)
    user_dir.mkdir(parents=True, exist_ok=True)

    ext = Path(file.filename or "").suffix.lower()
    unique_name = f"{uuid.uuid4().hex}{ext}"
    dest = user_dir / unique_name

    total = 0
    with open(dest, "wb") as out:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                out.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                                    f"File exceeds {settings.MAX_UPLOAD_SIZE_MB} MB limit")
            out.write(chunk)

    mime, _ = mimetypes.guess_type(file.filename or "")
    media = MediaFile(
        user_id=user.id,
        filename=unique_name,
        original_name=file.filename or unique_name,
        media_type=media_type,
        mime_type=mime or "",
        file_size=total,
        storage_path=str(dest),
        status="processing",
    )
    db.add(media)
    await db.commit()
    await db.refresh(media)
    await log_action(db, "media_upload", user.id, request, {"media_id": media.id, "type": media_type})

    # Run analysis synchronously (for MVP). Could be dispatched to Celery later.
    try:
        if media_type == "image":
            report = analyze_image(str(dest))
            signals = report.signals
        elif media_type == "audio":
            report = analyze_audio(str(dest))
            signals = report.signals
        else:  # video
            report = analyze_video(str(dest))
            signals = {"ensemble": report.signals, "timeline": report.frame_timeline}

        analysis = AnalysisResult(
            media_id=media.id,
            user_id=user.id,
            verdict=report.verdict,
            ai_probability=report.ai_probability,
            confidence=report.confidence,
            signals=signals,
            reasons=report.reasons,
        )
        db.add(analysis)
        media.status = "done"
        await db.commit()
        await db.refresh(analysis)
        await db.refresh(media)

        await log_action(db, "media_analyzed", user.id, request, {
            "media_id": media.id, "verdict": report.verdict, "ai_probability": report.ai_probability,
        })

        return MediaWithAnalysisOut(
            media=MediaOut.model_validate(media),
            analysis=AnalysisOut.model_validate(analysis),
        )
    except Exception as e:
        media.status = "failed"
        await db.commit()
        await log_action(db, "media_analysis_failed", user.id, request, {"media_id": media.id, "error": str(e)[:200]})
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Analysis failed: {e}")


@router.get("/", response_model=list[MediaWithAnalysisOut])
async def list_media(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    limit: int = 50,
    offset: int = 0,
):
    result = await db.execute(
        select(MediaFile).where(MediaFile.user_id == user.id)
        .order_by(MediaFile.created_at.desc())
        .limit(min(limit, 100)).offset(offset)
    )
    items = result.scalars().all()
    out = []
    for m in items:
        a_res = await db.execute(select(AnalysisResult).where(AnalysisResult.media_id == m.id))
        a = a_res.scalars().first()
        out.append(MediaWithAnalysisOut(
            media=MediaOut.model_validate(m),
            analysis=AnalysisOut.model_validate(a) if a else None,
        ))
    return out


@router.get("/{media_id}", response_model=MediaWithAnalysisOut)
async def get_media(
    media_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(MediaFile).where(MediaFile.id == media_id, MediaFile.user_id == user.id)
    )
    m = result.scalars().first()
    if not m:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Media not found")

    a_res = await db.execute(select(AnalysisResult).where(AnalysisResult.media_id == m.id))
    a = a_res.scalars().first()
    return MediaWithAnalysisOut(
        media=MediaOut.model_validate(m),
        analysis=AnalysisOut.model_validate(a) if a else None,
    )


@router.get("/{media_id}/file")
async def download_media_file(
    media_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Serve the user's own uploaded media back for preview. Owner-only."""
    result = await db.execute(
        select(MediaFile).where(MediaFile.id == media_id, MediaFile.user_id == user.id)
    )
    m = result.scalars().first()
    if not m or not os.path.exists(m.storage_path):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found")
    return FileResponse(m.storage_path, media_type=m.mime_type or "application/octet-stream", filename=m.original_name)


@router.delete("/{media_id}", status_code=204)
async def delete_media(
    media_id: int,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(MediaFile).where(MediaFile.id == media_id, MediaFile.user_id == user.id)
    )
    m = result.scalars().first()
    if not m:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Media not found")

    # Delete file on disk
    try:
        if os.path.exists(m.storage_path):
            os.remove(m.storage_path)
    except Exception:
        pass

    await db.delete(m)
    await db.commit()
    await log_action(db, "media_delete", user.id, request, {"media_id": media_id})
    return


@router.get("/stats/summary", response_model=StatsOut, include_in_schema=True)
async def dashboard_stats(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    total_uploads = (await db.execute(
        select(func.count(MediaFile.id)).where(MediaFile.user_id == user.id)
    )).scalar_one()
    total_analyses = (await db.execute(
        select(func.count(AnalysisResult.id)).where(AnalysisResult.user_id == user.id)
    )).scalar_one()
    likely_ai = (await db.execute(
        select(func.count(AnalysisResult.id))
        .where(AnalysisResult.user_id == user.id, AnalysisResult.verdict == "likely_ai")
    )).scalar_one()
    likely_real = (await db.execute(
        select(func.count(AnalysisResult.id))
        .where(AnalysisResult.user_id == user.id, AnalysisResult.verdict == "likely_real")
    )).scalar_one()
    inconclusive = (await db.execute(
        select(func.count(AnalysisResult.id))
        .where(AnalysisResult.user_id == user.id, AnalysisResult.verdict == "inconclusive")
    )).scalar_one()
    return StatsOut(
        total_uploads=total_uploads or 0,
        total_analyses=total_analyses or 0,
        likely_ai=likely_ai or 0,
        likely_real=likely_real or 0,
        inconclusive=inconclusive or 0,
    )
