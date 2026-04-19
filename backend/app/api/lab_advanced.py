from __future__ import annotations
import io
import os
import sys
import uuid
import wave
import base64
from pathlib import Path

import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont
from scipy.io import wavfile
from pydub import AudioSegment
import librosa
import soundfile as sf
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, Form, status
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.ml.video_detector import analyze_video
from app.ml.voice_transformer import VoiceTransformer, VoiceTransformConfig
from app.ml.video_transformer import VideoTransformer, VideoTransformConfig
from app.services.audit_service import log_action
from app.services.voice_conversion_service import (
    VoiceConversionProviderError,
    VoiceConversionService,
)

router = APIRouter(prefix="/lab-advanced", tags=["lab-advanced"])

# Voice transformation presets
VOICE_PRESETS = {
    "male_to_female": {
        "name": "Male to Female",
        "description": "Transform a masculine voice into a distinctly feminine tone",
    },
    "female_to_male": {
        "name": "Female to Male",
        "description": "Transform a feminine voice into a distinctly masculine tone",
    },
    "younger": {"name": "Child-like", "description": "Transform the voice toward a child-like tone"},
    "older": {"name": "Older Adult", "description": "Transform the voice toward an older adult tone"},
}

# Video transformation presets
VIDEO_PRESETS = {
    "gender_female": {
        "name": "Feminine Appearance",
        "description": "Softer skin, warmer tones, and feminine facial features",
        "gender_shift": -1.0,
        "skin_smoothness": 0.55,
        "eyes_enhancement": 0.5,
        "saturation": 0.15,
        "brightness": 0.05,
    },
    "gender_male": {
        "name": "Masculine Appearance",
        "description": "Sharper features, stronger jaw, and masculine facial structure",
        "gender_shift": 1.0,
        "skin_smoothness": 0.0,
        "saturation": -0.1,
    },
    "younger": {
        "name": "Younger Appearance",
        "description": "Smoother skin, brighter look, and youthful facial structure",
        "age_shift": -0.85,
        "skin_smoothness": 0.7,
        "eyes_enhancement": 0.4,
        "brightness": 0.1,
        "saturation": 0.12,
    },
    "older": {
        "name": "Older Appearance",
        "description": "Add texture, age lines, and mature facial appearance",
        "age_shift": 0.85,
        "saturation": -0.1,
        "brightness": -0.08,
    },
    "cartoon": {
        "name": "Cartoon / Kids Style",
        "description": "Transform video into a vivid cartoon / animated children's look",
        "style": "cartoon",
        "saturation": 0.6,
        "brightness": 0.15,
        "skin_smoothness": 0.4,
    },
    "enhanced": {
        "name": "Enhanced",
        "description": "Sharpen, brighten, and enhance overall video quality",
        "style": "enhance",
        "brightness": 0.12,
        "saturation": 0.22,
        "eyes_enhancement": 0.5,
    },
}

ALLOWED_VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".webm", ".mkv"}


def _output_dir() -> Path:
    p = Path(settings.STORAGE_PATH) / "results"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _is_supported_video_upload(file: UploadFile) -> bool:
    filename = (file.filename or "").lower()
    suffix = Path(filename).suffix.lower()
    content_type = (file.content_type or "").lower()
    if suffix in ALLOWED_VIDEO_EXTENSIONS:
        return True
    if content_type.startswith("video/"):
        return True
    return False


def _read_audio_wav(file_data: bytes, filename: str = "") -> tuple[np.ndarray, int] | None:
    """Read audio file (WAV, WebM, MP3, Opus, etc) and return audio array and sample rate.
    
    Uses librosa (best for all formats) with fallbacks to pydub and scipy.
    """
    # Primary: librosa (handles ALL formats, pure Python, no ffmpeg needed for most codecs)
    try:
        # Load audio directly from bytes using librosa
        audio, sr = librosa.load(io.BytesIO(file_data), sr=None, mono=True)
        
        # librosa returns float32 normalized to [-1, 1]
        return audio.astype(np.float32), int(sr)
    except Exception as e1:
        print(f"Librosa decode attempt failed: {e1}", file=sys.stderr)
    
    # Fallback 1: pydub (handles WebM, MP3, Opus via ffmpeg/system codecs)
    try:
        audio = AudioSegment.from_file(io.BytesIO(file_data))
        
        # Convert to mono, 16-bit
        audio = audio.set_channels(1).set_sample_width(2)
        sr = audio.frame_rate
        
        # Convert to numpy float32
        samples = np.array(audio.get_array_of_samples(), dtype=np.int16)
        audio_float = samples.astype(np.float32) / 32768.0
        
        return audio_float, int(sr)
    except Exception as e2:
        print(f"Pydub decode attempt failed: {e2}", file=sys.stderr)
    
    # Fallback 2: scipy (handles WAV)
    try:
        sr, data = wavfile.read(io.BytesIO(file_data))
        
        # Normalize to float32 [-1, 1]
        if data.dtype == np.int16:
            audio = data.astype(np.float32) / 32768.0
        elif data.dtype == np.int32:
            audio = data.astype(np.float32) / (2**31)
        elif data.dtype == np.uint8:
            audio = (data.astype(np.float32) - 128) / 128.0
        else:
            audio = data.astype(np.float32)
        
        # Handle stereo -> mono
        if len(audio.shape) > 1:
            audio = audio.mean(axis=1)
        
        return audio, int(sr)
    except Exception as e3:
        print(f"Scipy decode attempt failed: {e3}", file=sys.stderr)
    
    # Fallback 3: Python's wave module (handles WAV)
    try:
        with wave.open(io.BytesIO(file_data), "rb") as w:
            sr = w.getframerate()
            n = w.getnframes()
            ch = w.getnchannels()
            raw = w.readframes(n)
            sw = w.getsampwidth()

            if sw == 2:
                data = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
            elif sw == 1:
                data = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128) / 128.0
            else:
                data = np.frombuffer(raw, dtype=np.int32).astype(np.float32) / (2**31)

            if ch > 1:
                data = data.reshape(-1, ch).mean(axis=1)

            return data, sr
    except Exception as e4:
        print(f"Audio decode failed - librosa: {e1}, pydub: {e2}, scipy: {e3}, wave: {e4}", file=sys.stderr)
        return None


def _write_audio_wav(audio: np.ndarray, sr: int) -> bytes:
    """Convert audio array to WAV bytes."""
    # Ensure audio is in valid range
    audio = np.clip(audio, -1.0, 1.0)
    
    # Convert to int16
    audio_int16 = (audio * 32767).astype(np.int16)

    # Write using scipy
    output = io.BytesIO()
    wavfile.write(output, sr, audio_int16)
    output.seek(0)
    return output.getvalue()


# === VOICE TRANSFORMATION ENDPOINTS ===


@router.get("/voice-presets")
async def get_voice_presets():
    """Get available voice transformation presets."""
    model_map = {
        preset_id: VoiceConversionService.model_for_preset(preset_id)
        for preset_id in VOICE_PRESETS.keys()
    }
    return {
        "presets": [
            {"id": k, "name": v["name"], "description": v["description"]}
            for k, v in VOICE_PRESETS.items()
        ],
        "reference_datasets": [
            {
                "name": "VCTK Corpus",
                "purpose": "Multi-speaker reference dataset commonly used for voice conversion and speaker adaptation research.",
                "url": "https://datashare.ed.ac.uk/handle/10283/3443",
            },
            {
                "name": "LibriTTS",
                "purpose": "Large multi-speaker English speech corpus useful for TTS and timbre-transfer experiments.",
                "url": "https://www.openslr.org/60/",
            },
            {
                "name": "LibriTTS-R",
                "purpose": "Restored higher-quality LibriTTS variant that can improve cleaner model outputs.",
                "url": "https://www.openslr.org/141/",
            },
        ],
        "recommended_model_path": "For exact voice conversion beyond DSP effects, connect a trained RVC-style or similar voice-conversion model using your own licensed training data.",
        "provider_mode": (
            "external-model" if VoiceConversionService.provider_enabled() else "local-dsp"
        ),
        "configured_models": model_map,
    }


@router.post("/voice-transform", status_code=201)
async def transform_voice(
    request: Request,
    file: UploadFile = File(...),
    preset: str = Form(...),
    pitch_shift: float = Form(0),
    speed: float = Form(1.0),
    formant_shift: float = Form(0),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Transform voice with preset or custom parameters."""
    # Validate preset
    if preset not in VOICE_PRESETS and preset != "custom":
        raise HTTPException(400, f"Unknown preset. Allowed: {list(VOICE_PRESETS.keys())}")

    # Validate file type (accept all files - will detect by content)
    # Don't validate MIME type strictly since browsers vary in what they send
    
    # Read file
    data = await file.read()
    if len(data) > settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024:
        raise HTTPException(413, "File too large")

    # Parse audio - pass filename for better format detection
    filename = file.filename or "audio"
    audio_sr = _read_audio_wav(data, filename)
    if audio_sr is None:
        raise HTTPException(400, "Could not decode audio file. Supported: WAV, MP3, WebM, Opus, OGG, M4A")

    audio, sr = audio_sr

    engine = "local-dsp-voice-transform"
    provider_mode = "local-dsp"
    model_id = None
    response_mime_type = "audio/wav"

    # Apply transformation
    if preset != "custom":
        transformed = None
        if VoiceConversionService.provider_enabled():
            try:
                provider_result = VoiceConversionService.convert_with_provider(
                    audio_bytes=data,
                    filename=filename,
                    preset=preset,
                    sample_rate=sr,
                )
                wav_bytes = provider_result.audio_bytes
                engine = provider_result.engine
                provider_mode = provider_result.provider_mode
                model_id = provider_result.model_id
                response_mime_type = provider_result.mime_type or "audio/wav"
            except VoiceConversionProviderError:
                transformed = VoiceTransformer.transform(
                    audio, sr, preset=preset, config=None
                )
        else:
            transformed = VoiceTransformer.transform(
                audio, sr, preset=preset, config=None
            )
    else:
        config = VoiceTransformConfig(
            pitch_shift=pitch_shift,
            speed=max(0.8, min(1.5, speed)),
            formant_shift=formant_shift,
            depth=0.8,
        )
        transformed = VoiceTransformer.transform(
            audio, sr, preset=None, config=config
        )

    # Convert back to WAV
    if preset == "custom" or transformed is not None:
        wav_bytes = _write_audio_wav(transformed, sr)
        response_mime_type = "audio/wav"
    elif response_mime_type != "audio/wav":
        decoded_provider_audio = _read_audio_wav(wav_bytes, filename)
        if decoded_provider_audio is not None:
            provider_audio, provider_sr = decoded_provider_audio
            wav_bytes = _write_audio_wav(provider_audio, provider_sr)
            response_mime_type = "audio/wav"

    # Save file
    out_dir = _output_dir() / str(user.id)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_name = f"voice_{uuid.uuid4().hex}.wav"
    out_path = out_dir / out_name

    with open(out_path, "wb") as f:
        f.write(wav_bytes)

    await log_action(
        db,
        "lab_voice_transform",
        user.id,
        request,
        {
            "preset": preset,
            "pitch_shift": pitch_shift,
            "speed": speed,
            "output": out_name,
            "size_kb": len(wav_bytes) // 1024,
            "engine": engine,
            "provider_mode": provider_mode,
            "model_id": model_id,
        },
    )

    return {
        "message": "Voice transformation complete",
        "preset": preset,
        "download_url": f"{settings.API_V1_PREFIX}/lab-advanced/voice-download/{out_name}",
        "mime_type": response_mime_type,
        "audio_base64": base64.b64encode(wav_bytes).decode("ascii"),
        "engine": engine,
        "provider_mode": provider_mode,
        "model_id": model_id,
    }


@router.get("/voice-download/{filename}")
async def download_voice_result(
    filename: str,
    user: User = Depends(get_current_user),
):
    """Download transformed voice file."""
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(400, "Invalid filename")

    out_path = _output_dir() / str(user.id) / filename
    if not out_path.exists():
        raise HTTPException(404, "Result not found")

    return FileResponse(out_path, media_type="audio/wav", filename=filename)


# === VIDEO TRANSFORMATION ENDPOINTS ===


@router.get("/video-presets")
async def get_video_presets():
    """Get available video transformation presets."""
    return {
        "presets": [
            {"id": k, "name": v["name"], "description": v["description"]}
            for k, v in VIDEO_PRESETS.items()
        ],
        "disclaimer": "Demo/example feature only. Outputs are illustrative AI-generated edits for testing and must not be used for deception or impersonation.",
        "generation_note": "This demo currently uses a local ML-assisted video pipeline so you can retry safely while the experience is being refined.",
    }


@router.post("/video-transform", status_code=201)
async def transform_video(
    request: Request,
    file: UploadFile = File(...),
    preset: str = Form(...),
    consent_own_media: bool = Form(...),
    consent_ai_label: bool = Form(...),
    gender_shift: float = Form(0),
    age_shift: float = Form(0),
    skin_smoothness: float = Form(0),
    eyes_enhancement: float = Form(0),
    brightness: float = Form(0),
    saturation: float = Form(0),
    style: str = Form("original"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Transform video with preset or custom parameters."""
    if not consent_own_media:
        raise HTTPException(400, "You must confirm the video is yours or you have permission to transform it.")
    if not consent_ai_label:
        raise HTTPException(400, "You must acknowledge that the output is AI-generated and cannot be used deceptively.")

    # Validate preset
    if preset not in VIDEO_PRESETS and preset != "custom":
        raise HTTPException(400, f"Unknown preset. Allowed: {list(VIDEO_PRESETS.keys())}")

    # Validate file type
    if not _is_supported_video_upload(file):
        raise HTTPException(
            415, "Only MP4, MOV, AVI, and WebM video files are supported"
        )

    # Read file
    data = await file.read()
    if len(data) > 100 * 1024 * 1024:  # 100MB limit for videos
        raise HTTPException(413, "Video file too large")

    await log_action(
        db,
        "lab_video_transform_attempt",
        user.id,
        request,
        {
            "preset": preset,
            "filename": file.filename or "video",
            "content_type": file.content_type or "",
        },
    )

    # Save temp video file
    temp_dir = Path(settings.STORAGE_PATH) / "temp"
    temp_dir.mkdir(parents=True, exist_ok=True)
    input_suffix = Path(file.filename or "").suffix.lower()
    if input_suffix not in ALLOWED_VIDEO_EXTENSIONS:
        content_type = (file.content_type or "").lower()
        if "webm" in content_type:
            input_suffix = ".webm"
        elif "quicktime" in content_type:
            input_suffix = ".mov"
        elif "avi" in content_type or "msvideo" in content_type:
            input_suffix = ".avi"
        else:
            input_suffix = ".mp4"

    temp_input = temp_dir / f"{uuid.uuid4().hex}{input_suffix}"

    try:
        with open(temp_input, "wb") as f:
            f.write(data)

        # Create transformation config
        if preset != "custom":
            preset_config = VIDEO_PRESETS[preset]
            config = VideoTransformConfig(
                gender_shift=preset_config.get("gender_shift", 0),
                age_shift=preset_config.get("age_shift", 0),
                skin_smoothness=preset_config.get("skin_smoothness", 0),
                eyes_enhancement=preset_config.get("eyes_enhancement", 0),
                brightness=preset_config.get("brightness", 0),
                saturation=preset_config.get("saturation", 0),
                style=preset_config.get("style", "original"),
            )
        else:
            config = VideoTransformConfig(
                gender_shift=max(-1, min(1, gender_shift)),
                age_shift=max(-1, min(1, age_shift)),
                skin_smoothness=max(0, min(1, skin_smoothness)),
                eyes_enhancement=max(0, min(1, eyes_enhancement)),
                brightness=max(-1, min(1, brightness)),
                saturation=max(-1, min(1, saturation)),
                style=style,
            )

        # Process video
        out_dir = _output_dir() / str(user.id)
        out_dir.mkdir(parents=True, exist_ok=True)
        out_name = f"video_{uuid.uuid4().hex}.mp4"
        out_path = out_dir / out_name

        success = VideoTransformer.transform_video(
            str(temp_input), str(out_path), config
        )

        if not success:
            raise HTTPException(400, "Failed to process video")

        analysis = analyze_video(str(out_path))
        with open(out_path, "rb") as generated_video:
            video_bytes = generated_video.read()

        await log_action(
            db,
            "lab_video_transform",
            user.id,
            request,
            {
                "preset": preset,
                "gender_shift": config.gender_shift,
                "age_shift": config.age_shift,
                "output": out_name,
                "size_mb": os.path.getsize(out_path) / (1024 * 1024),
                "consent_own_media": consent_own_media,
                "consent_ai_label": consent_ai_label,
            },
        )

        return {
            "message": "Video transformation complete",
            "preset": preset,
            "download_url": f"{settings.API_V1_PREFIX}/lab-advanced/video-download/{out_name}",
            "disclaimer": "For demo/example use only. This edited video is AI-generated and must not be used for deception, impersonation, or identity fraud.",
            "engine": "local-ml-demo-video-transformer",
            "mime_type": "video/mp4",
            "video_base64": base64.b64encode(video_bytes).decode("ascii"),
            "analysis": {
                "ai_probability": analysis.ai_probability,
                "confidence": analysis.confidence,
                "verdict": analysis.verdict,
                "reasons": analysis.reasons,
            },
        }

    finally:
        # Clean up temp file
        if temp_input.exists():
            temp_input.unlink()


@router.get("/video-download/{filename}")
async def download_video_result(
    filename: str,
    user: User = Depends(get_current_user),
):
    """Download transformed video file."""
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(400, "Invalid filename")

    out_path = _output_dir() / str(user.id) / filename
    if not out_path.exists():
        raise HTTPException(404, "Result not found")

    return FileResponse(out_path, media_type="video/mp4", filename=filename)
