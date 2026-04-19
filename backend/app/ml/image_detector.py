"""
ArtFrame image forensic detection.

Ensemble of 9 forensic signals covering ELA, frequency, noise, texture,
rendering style, color coherence, depth uniformity, file metadata, and JPEG header.
Each signal returns a 0..1 AI-likelihood score plus a plain-language reason.
"""
from __future__ import annotations

import io
from dataclasses import dataclass, field
from typing import Dict, Tuple

import numpy as np
from PIL import ExifTags, Image, ImageChops


def _clip01(x: float) -> float:
    return float(max(0.0, min(1.0, x)))


def _remap(value: float, in_min: float, in_max: float) -> float:
    if in_max <= in_min:
        return 0.0
    return _clip01((value - in_min) / (in_max - in_min))


# ---------------------------------------------------------------------------
# Signal 1: Metadata / EXIF
# ---------------------------------------------------------------------------

def signal_metadata(img: Image.Image) -> Tuple[float, str, dict]:
    """Missing capture metadata is weak evidence; explicit AI tags are strong evidence."""
    exif_data: dict = {}
    try:
        raw = img.getexif()
        if raw:
            for tag_id, val in raw.items():
                tag = ExifTags.TAGS.get(tag_id, str(tag_id))
                try:
                    exif_data[tag] = str(val)[:120]
                except Exception:
                    pass
    except Exception:
        pass

    fmt = (img.format or "").upper()
    has_make = any(k in exif_data for k in ("Make", "Model"))
    has_datetime = "DateTime" in exif_data or "DateTimeOriginal" in exif_data
    has_software = "Software" in exif_data

    score = 0.0
    notes = []
    if not exif_data:
        score = 0.35 if fmt in {"PNG", "WEBP"} else 0.50
        notes.append("No EXIF metadata — real cameras always embed capture data")
    else:
        if not has_make:
            score += 0.20
            notes.append("No camera make/model in metadata")
        if not has_datetime:
            score += 0.12
            notes.append("No capture timestamp")
        if has_software:
            sw = exif_data.get("Software", "").lower()
            if any(k in sw for k in ("stable", "midjourney", "dall", "diffusion", "gan", "ai", "firefly", "imagen")):
                score = max(score, 0.97)
                notes.append(f"Software tag explicitly names an AI generator: {exif_data['Software']}")
            elif any(k in sw for k in ("photoshop", "lightroom", "snapseed", "gimp", "canva")):
                score = max(score, 0.35)
                notes.append(f"Edited/exported with: {exif_data['Software']}")

    reason = "; ".join(notes) if notes else "Metadata looks consistent with a real camera capture"
    return _clip01(score), reason, {
        "format": fmt,
        "exif_count": len(exif_data),
        "exif_keys": list(exif_data.keys())[:12],
    }


# ---------------------------------------------------------------------------
# Signal 2: ELA – Error Level Analysis
# ---------------------------------------------------------------------------

def signal_ela(img: Image.Image, quality: int = 90) -> Tuple[float, str, dict]:
    """Recompress the image and inspect error-level structure."""
    rgb = img.convert("RGB")
    buf = io.BytesIO()
    rgb.save(buf, "JPEG", quality=quality)
    buf.seek(0)
    resaved = Image.open(buf)
    diff = ImageChops.difference(rgb, resaved)
    arr = np.asarray(diff, dtype=np.float32)
    mean_e = float(arr.mean())
    std_e = float(arr.std())
    max_e = float(arr.max())

    flatness = 1.0 - _clip01(std_e / 14.0)
    low_energy = 1.0 - _clip01(mean_e / 12.0)
    hotspot = _remap(std_e, 18.0, 42.0) * _remap(max_e, 120.0, 255.0)
    score = _clip01(flatness * 0.55 + low_energy * 0.25 + hotspot * 0.35)

    if std_e < 2.0 and mean_e < 2.0:
        score = max(score, 0.80)
        reason = "Error levels are uniformly flat — AI-generated images have no real JPEG compression history"
    elif std_e > 25 and max_e > 200:
        score = max(score, 0.62)
        reason = "Strong error-level hotspots suggest synthetic reconstruction or heavy editing"
    elif 4.0 <= std_e <= 16.0 and mean_e >= 2.0:
        score = min(score, 0.28)
        reason = "Error levels look natural for a compressed photograph"
    else:
        score = max(score, 0.42)
        reason = "Error-level pattern is ambiguous"

    return _clip01(score), reason, {
        "mean": round(mean_e, 3),
        "std": round(std_e, 3),
        "max": round(max_e, 2),
        "flatness": round(flatness, 3),
    }


# ---------------------------------------------------------------------------
# Signal 3: FFT – Frequency domain
# ---------------------------------------------------------------------------

def signal_fft(img: Image.Image) -> Tuple[float, str, dict]:
    """Look for oversmoothing or unusual high-frequency behaviour."""
    arr = np.asarray(img.convert("L").resize((256, 256)), dtype=np.float32)
    f = np.fft.fftshift(np.fft.fft2(arr))
    mag = np.log1p(np.abs(f))
    cy, cx = mag.shape[0] // 2, mag.shape[1] // 2

    y, x = np.indices(mag.shape)
    r = np.sqrt((x - cx) ** 2 + (y - cy) ** 2).astype(np.int32)
    r = np.clip(r, 0, cy - 1)
    profile = np.bincount(r.ravel(), mag.ravel()) / (np.bincount(r.ravel()) + 1e-9)

    mid = float(profile[20:60].mean())
    high = float(profile[80:120].mean())
    ratio = high / (mid + 1e-6)

    low_hf = _remap(0.60 - ratio, 0.0, 0.30)
    excessive_hf = _remap(ratio - 0.92, 0.0, 0.30)
    score = _clip01(low_hf * 0.8 + excessive_hf * 0.55)

    if ratio < 0.45:
        score = max(score, 0.74)
        reason = "High-frequency content is unnaturally weak — typical of synthetic over-smoothing"
    elif ratio > 1.1:
        score = max(score, 0.58)
        reason = "High-frequency content is unusually strong — suggests generation artefacts"
    elif 0.58 <= ratio <= 0.88:
        score = min(score, 0.22)
        reason = "Frequency profile sits within a natural photographic range"
    else:
        score = max(score, 0.38)
        reason = "Frequency profile is slightly atypical"

    return _clip01(score), reason, {
        "hf_mf_ratio": round(ratio, 3),
        "mid_energy": round(mid, 3),
        "high_energy": round(high, 3),
    }


# ---------------------------------------------------------------------------
# Signal 4: Noise – sensor noise residual
# ---------------------------------------------------------------------------

def signal_noise(img: Image.Image) -> Tuple[float, str, dict]:
    """Estimate whether the image has natural sensor-like noise."""
    arr = np.asarray(img.convert("L").resize((512, 512)), dtype=np.float32)
    k = np.array([[0, 1, 0], [1, -4, 1], [0, 1, 0]], dtype=np.float32)
    pad = np.pad(arr, 1, mode="edge")
    lap = (
        k[0, 1] * pad[:-2, 1:-1]
        + k[1, 0] * pad[1:-1, :-2]
        + k[1, 1] * pad[1:-1, 1:-1]
        + k[1, 2] * pad[1:-1, 2:]
        + k[2, 1] * pad[2:, 1:-1]
    )
    noise_var = float(lap.var())

    low_noise = _remap(24.0 - noise_var, 0.0, 24.0)
    excessive_noise = _remap(noise_var - 380.0, 0.0, 320.0)
    score = _clip01(low_noise * 0.85 + excessive_noise * 0.35)

    if noise_var < 8:
        score = max(score, 0.80)
        reason = "Extremely low noise — real cameras always introduce sensor noise; this image is unnaturally clean"
    elif noise_var > 500:
        score = max(score, 0.48)
        reason = "Noise variance is unusually high — may result from synthetic particle or glow effects"
    elif 24 <= noise_var <= 260:
        score = min(score, 0.18)
        reason = "Noise residual is consistent with a real sensor capture"
    else:
        score = max(score, 0.34)
        reason = "Noise residual is somewhat atypical"

    return _clip01(score), reason, {"noise_variance": round(noise_var, 2)}


# ---------------------------------------------------------------------------
# Signal 5: Texture variance
# ---------------------------------------------------------------------------

def signal_texture(img: Image.Image) -> Tuple[float, str, dict]:
    """Measure how much of the image is unnaturally smooth."""
    arr = np.asarray(img.convert("L").resize((256, 256)), dtype=np.float32)
    block = 16
    h, w = arr.shape
    variances = []
    for by in range(0, h, block):
        for bx in range(0, w, block):
            patch = arr[by:by + block, bx:bx + block]
            if patch.size:
                variances.append(float(patch.var()))
    variances = np.asarray(variances, dtype=np.float32)
    smooth_ratio = float((variances < 15).mean())

    oversmooth = _remap(smooth_ratio, 0.24, 0.72)
    highly_detailed = _remap(0.09 - smooth_ratio, 0.0, 0.09)
    score = _clip01(oversmooth * 0.82 + highly_detailed * 0.22)

    if smooth_ratio > 0.55:
        score = max(score, 0.72)
        reason = f"{int(smooth_ratio * 100)}% of image patches are ultra-smooth — unnaturally clean for real photography"
    elif smooth_ratio < 0.08:
        score = min(score, 0.22)
        reason = "Texture variance looks natural for a photograph"
    elif 0.08 <= smooth_ratio <= 0.22:
        score = min(score, 0.28)
        reason = "Texture distribution is broadly consistent with a natural photo"
    else:
        score = max(score, 0.42)
        reason = "Texture distribution is mixed"

    return _clip01(score), reason, {"smooth_block_ratio": round(smooth_ratio, 3)}


# ---------------------------------------------------------------------------
# Signal 6: Rendering style
# ---------------------------------------------------------------------------

def signal_rendering_style(img: Image.Image) -> Tuple[float, str, dict]:
    """
    Detect stylized / synthetic rendering: smooth shading, limited palette,
    low micro-detail entropy, and glow/bloom effects common in AI art.
    """
    rgb = np.asarray(img.convert("RGB").resize((256, 256)), dtype=np.float32)
    gray = np.asarray(img.convert("L").resize((256, 256)), dtype=np.uint8)

    # Palette diversity after coarse quantization
    quant = (rgb // 16).astype(np.int32)
    packed = (quant[..., 0] * 256 + quant[..., 1] * 16 + quant[..., 2]).reshape(-1)
    diversity = float(np.unique(packed).size) / 4096.0

    # Shannon entropy of grayscale histogram
    hist = np.bincount(gray.reshape(-1), minlength=256).astype(np.float32)
    probs = hist / max(hist.sum(), 1.0)
    entropy = float(-(probs[probs > 0] * np.log2(probs[probs > 0])).sum())

    # Edge density
    gy, gx = np.gradient(gray.astype(np.float32))
    grad_mag = np.sqrt(gx ** 2 + gy ** 2)
    edge_density = float((grad_mag > 18).mean())

    # Glow/bloom: bright AND saturated regions (AI sci-fi/fantasy style)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    brightness = (r + g + b) / 3.0
    max_c = np.maximum(np.maximum(r, g), b)
    min_c = np.minimum(np.minimum(r, g), b)
    saturation = np.where(max_c > 5, (max_c - min_c) / (max_c + 1e-6), 0.0)
    glow_mask = (brightness > 160) & (saturation > 0.45)
    glow_ratio = float(glow_mask.mean())

    low_diversity = _remap(0.22 - diversity, 0.0, 0.18)
    low_entropy = _remap(6.9 - entropy, 0.0, 1.9)
    soft_edges = _remap(0.12 - edge_density, 0.0, 0.08)
    glow_boost = _remap(glow_ratio, 0.06, 0.28)
    score = _clip01(
        low_diversity * 0.28
        + low_entropy * 0.24
        + soft_edges * 0.20
        + glow_boost * 0.28
    )

    if glow_ratio > 0.18:
        score = max(score, 0.80)
        reason = (
            f"Image contains extensive glow/bloom effects ({int(glow_ratio*100)}% of pixels) — "
            "a hallmark of AI art generators producing sci-fi or fantasy scenes"
        )
    elif score >= 0.65:
        reason = "Rendering style is unnaturally polished — palette, entropy, and edge profile all suggest synthetic generation"
    elif score >= 0.45:
        reason = "Rendering style has illustration-like or AI-art traits"
    else:
        reason = "Rendering style is not strongly suggestive of synthetic generation"

    return _clip01(score), reason, {
        "palette_diversity": round(diversity, 3),
        "entropy": round(entropy, 3),
        "edge_density": round(edge_density, 3),
        "glow_ratio": round(glow_ratio, 3),
    }


# ---------------------------------------------------------------------------
# Signal 7: JPEG header / file markers
# ---------------------------------------------------------------------------

def signal_jpeg(img: Image.Image, raw_bytes: bytes) -> Tuple[float, str, dict]:
    """Look for file-format clues and obvious AI markers in the header."""
    fmt = (img.format or "").upper()
    score = 0.0
    notes = []
    details = {"format": fmt}

    if fmt not in ("JPEG", "JPG", "PNG", "WEBP"):
        score += 0.1
        notes.append(f"Unusual format: {fmt}")

    if fmt == "PNG":
        score += 0.18
        notes.append("PNG format — real cameras output JPEG; PNG often indicates a generated or exported asset")
    elif fmt == "WEBP":
        score += 0.14
        notes.append("WEBP format — often indicates a web-exported or recompressed asset")

    lowered = raw_bytes[:8192].lower()
    ai_markers = [
        b"stable-diffusion", b"midjourney", b"dall-e", b"stability",
        b"diffusion", b"firefly", b"imagen", b"comfyui", b"automatic1111",
    ]
    for marker in ai_markers:
        if marker in lowered:
            score = 0.97
            notes.append(f"AI generator signature '{marker.decode(errors='ignore')}' found in file")
            details["marker"] = marker.decode(errors="ignore")
            break

    reason = "; ".join(notes) if notes else "File header is consistent with a normal camera or app export"
    return _clip01(score), reason, details


# ---------------------------------------------------------------------------
# Signal 8: Color coherence  ← NEW
# ---------------------------------------------------------------------------

def signal_color_coherence(img: Image.Image) -> Tuple[float, str, dict]:
    """
    AI images — especially those from Midjourney, SDXL, DALL-E — commonly have
    vivid, oversaturated, neon color palettes that rarely occur in real photography.
    We measure mean saturation and the ratio of 'neon' pixels.
    """
    rgb = np.asarray(img.convert("RGB").resize((256, 256)), dtype=np.float32)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]

    max_c = np.maximum(np.maximum(r, g), b)
    min_c = np.minimum(np.minimum(r, g), b)
    saturation = np.where(max_c > 10, (max_c - min_c) / (max_c + 1e-6), 0.0)

    mean_sat = float(saturation.mean())
    high_sat_ratio = float((saturation > 0.60).mean())

    # Neon: high saturation + moderate-to-high brightness (not near black)
    brightness = (r + g + b) / 3.0
    vivid_neon = float(((saturation > 0.65) & (brightness > 80)).mean())

    # Dark background with neon highlights — very common AI sci-fi pattern
    dark_bg_ratio = float((brightness < 40).mean())
    dark_neon_contrast = dark_bg_ratio * vivid_neon * 4.0  # amplify co-occurrence

    score = _clip01(
        _remap(mean_sat, 0.22, 0.52) * 0.25
        + _remap(high_sat_ratio, 0.20, 0.55) * 0.30
        + _remap(vivid_neon, 0.04, 0.22) * 0.30
        + _remap(dark_neon_contrast, 0.02, 0.15) * 0.15
    )

    if vivid_neon > 0.15 and dark_bg_ratio > 0.20:
        score = max(score, 0.85)
        reason = (
            f"Vivid neon colors on dark background ({int(vivid_neon*100)}% neon pixels, "
            f"{int(dark_bg_ratio*100)}% dark background) — this contrast pattern is a "
            "signature of AI art generators, not real photography"
        )
    elif vivid_neon > 0.12:
        score = max(score, 0.75)
        reason = (
            f"Extreme color saturation: {int(vivid_neon*100)}% of pixels are vivid neon — "
            "real photos almost never reach this saturation level"
        )
    elif mean_sat > 0.40:
        score = max(score, 0.60)
        reason = f"Mean saturation ({mean_sat:.2f}) is unusually high — AI images tend to have over-vivid palettes"
    elif mean_sat < 0.12:
        score = min(score, 0.22)
        reason = "Low, natural color saturation — consistent with real photography"
    else:
        reason = "Color saturation is within a normal range"

    return _clip01(score), reason, {
        "mean_saturation": round(mean_sat, 3),
        "high_sat_ratio": round(high_sat_ratio, 3),
        "vivid_neon_ratio": round(vivid_neon, 3),
        "dark_bg_ratio": round(dark_bg_ratio, 3),
    }


# ---------------------------------------------------------------------------
# Signal 9: Depth / sharpness uniformity  ← NEW
# ---------------------------------------------------------------------------

def signal_depth_uniformity(img: Image.Image) -> Tuple[float, str, dict]:
    """
    Real photographs have depth-of-field: near subjects are sharp, far ones
    are blurred. AI images tend to render everything with uniform sharpness
    (or uniform blur), lacking the natural sharpness gradient of a real lens.
    """
    gray = np.asarray(img.convert("L").resize((256, 256)), dtype=np.float32)
    block = 32
    h, w = gray.shape
    variances = []
    for by in range(0, h, block):
        for bx in range(0, w, block):
            patch = gray[by:by + block, bx:bx + block]
            if patch.size >= 4:
                variances.append(float(patch.var()))

    if len(variances) < 4:
        return 0.5, "Not enough blocks for depth analysis", {}

    arr_v = np.array(variances, dtype=np.float32)
    cv = float(arr_v.std() / (arr_v.mean() + 1e-6))

    # Real photos: high CV due to DoF variation
    # AI images: low CV (everything rendered at same detail level)
    if cv < 0.45:
        score = 0.72
        reason = (
            "Sharpness is uniformly distributed across the image — real cameras create "
            "natural depth-of-field blur variation, which is absent here"
        )
    elif cv < 0.80:
        score = 0.50
        reason = "Sharpness variation is limited — slightly unusual for a real photograph with depth of field"
    elif cv < 1.60:
        score = 0.22
        reason = "Natural sharpness variation across the image, consistent with camera depth of field"
    else:
        score = 0.16
        reason = "Strong depth-of-field variation present — consistent with real lens optics"

    return _clip01(score), reason, {
        "sharpness_cv": round(cv, 3),
        "mean_block_var": round(float(arr_v.mean()), 2),
        "std_block_var": round(float(arr_v.std()), 2),
    }


# ---------------------------------------------------------------------------
# Report dataclass
# ---------------------------------------------------------------------------

@dataclass
class ImageForensicReport:
    ai_probability: float
    confidence: float
    verdict: str
    reasons: str
    signals: Dict[str, Dict] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Weights — 9 signals
# ---------------------------------------------------------------------------

WEIGHTS = {
    "metadata":  0.08,
    "ela":       0.17,
    "fft":       0.11,
    "noise":     0.11,
    "texture":   0.10,
    "rendering": 0.15,
    "jpeg":      0.06,
    "color":     0.14,   # new — catches vivid AI color palettes
    "depth":     0.08,   # new — catches uniform sharpness
}


# ---------------------------------------------------------------------------
# Main analysis function
# ---------------------------------------------------------------------------

def analyze_image(path: str) -> ImageForensicReport:
    with open(path, "rb") as f:
        raw = f.read()
    img = Image.open(io.BytesIO(raw))
    img.load()

    signals: Dict[str, Dict] = {}

    s_meta, r_meta, d_meta = signal_metadata(img)
    signals["metadata"] = {"score": s_meta, "reason": r_meta, "details": d_meta}

    s_ela, r_ela, d_ela = signal_ela(img)
    signals["ela"] = {"score": s_ela, "reason": r_ela, "details": d_ela}

    s_fft, r_fft, d_fft = signal_fft(img)
    signals["fft"] = {"score": s_fft, "reason": r_fft, "details": d_fft}

    s_noise, r_noise, d_noise = signal_noise(img)
    signals["noise"] = {"score": s_noise, "reason": r_noise, "details": d_noise}

    s_tex, r_tex, d_tex = signal_texture(img)
    signals["texture"] = {"score": s_tex, "reason": r_tex, "details": d_tex}

    s_render, r_render, d_render = signal_rendering_style(img)
    signals["rendering"] = {"score": s_render, "reason": r_render, "details": d_render}

    s_jpeg, r_jpeg, d_jpeg = signal_jpeg(img, raw)
    signals["jpeg"] = {"score": s_jpeg, "reason": r_jpeg, "details": d_jpeg}

    s_color, r_color, d_color = signal_color_coherence(img)
    signals["color"] = {"score": s_color, "reason": r_color, "details": d_color}

    s_depth, r_depth, d_depth = signal_depth_uniformity(img)
    signals["depth"] = {"score": s_depth, "reason": r_depth, "details": d_depth}

    # --- Weighted ensemble ---
    weights = np.array([WEIGHTS[k] for k in WEIGHTS], dtype=np.float32)
    scores  = np.array([signals[k]["score"] for k in WEIGHTS], dtype=np.float32)
    raw_ai_prob = float(np.dot(scores, weights))

    high_support = float(weights[scores >= 0.62].sum())
    low_support  = float(weights[scores <= 0.30].sum())
    ambiguity    = float(np.average(np.abs(scores - 0.5), weights=weights))
    consensus_shift = high_support * 0.22 - low_support * 0.10
    spread_gain     = 1.0 + ambiguity * 0.45
    ai_prob = _clip01(raw_ai_prob * spread_gain + consensus_shift)

    # Consensus-based floors
    strong_ai   = sum(1 for k in WEIGHTS if signals[k]["score"] >= 0.62)
    strong_real = sum(WEIGHTS[k] for k in WEIGHTS if signals[k]["score"] <= 0.22)

    if strong_ai >= 5:
        ai_prob = max(ai_prob, 0.88)
    elif strong_ai >= 4:
        ai_prob = max(ai_prob, 0.78)
    elif strong_ai >= 3 and strong_real < 0.22:
        ai_prob = max(ai_prob, 0.68)
    elif strong_ai >= 2 and strong_real < 0.14:
        ai_prob = max(ai_prob, 0.58)
    elif high_support >= 0.36:
        ai_prob = max(ai_prob, min(0.82, raw_ai_prob + high_support * 0.32))

    # Hard ceiling for images with very strong real signals
    if low_support >= 0.55 and strong_ai == 0:
        ai_prob = min(ai_prob, 0.30)

    weighted_std    = float(np.sqrt(np.average((scores - raw_ai_prob) ** 2, weights=weights)))
    agreement       = 1.0 - weighted_std
    evidence_strength = abs(ai_prob - 0.5) * 2.0
    confidence = _clip01(0.30 + agreement * 0.30 + evidence_strength * 0.25 + ambiguity * 0.15)

    if ai_prob >= 0.65:
        verdict = "likely_ai"
    elif ai_prob <= 0.35:
        verdict = "likely_real"
    else:
        verdict = "inconclusive"

    # Build human-readable summary from the top contributing signals
    ranked = sorted(
        signals.items(),
        key=lambda kv: abs(kv[1]["score"] - 0.5),
        reverse=True,
    )
    # Lead with the strongest AI signal if verdict is AI, else strongest real signal
    top_reasons = []
    if verdict == "likely_ai":
        for key, sig in ranked:
            if sig["score"] >= 0.55 and key != "ensemble_summary":
                top_reasons.append(sig["reason"])
            if len(top_reasons) >= 3:
                break
    else:
        for key, sig in ranked:
            if key != "ensemble_summary":
                top_reasons.append(sig["reason"])
            if len(top_reasons) >= 3:
                break

    reasons = " • ".join(top_reasons) if top_reasons else ranked[0][1]["reason"]

    signals["ensemble_summary"] = {
        "score": round(ai_prob, 3),
        "reason": "Combined weighted decision across 9 forensic signals",
        "details": {
            "raw_weighted_score": round(raw_ai_prob, 3),
            "high_support": round(high_support, 3),
            "low_support": round(low_support, 3),
            "strong_ai_signals": strong_ai,
            "weighted_std": round(weighted_std, 3),
        },
    }

    return ImageForensicReport(
        ai_probability=round(ai_prob, 3),
        confidence=round(confidence, 3),
        verdict=verdict,
        reasons=reasons,
        signals=signals,
    )
