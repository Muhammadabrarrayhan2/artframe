"""
Lightweight audio forensic heuristics using only numpy + wave/soundfile fallback.
For production, swap in librosa + a trained classifier. This module exists so
the end-to-end pipeline runs on systems that can't install librosa easily.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Dict
import wave
import numpy as np
import os

try:
    import soundfile as sf
except Exception:  # pragma: no cover - optional dependency fallback
    sf = None


@dataclass
class AudioReport:
    ai_probability: float
    confidence: float
    verdict: str
    reasons: str
    signals: Dict[str, Dict] = field(default_factory=dict)


def _read_audio_wave(path: str) -> tuple[np.ndarray, int] | None:
    if sf is not None:
        try:
            data, sr = sf.read(path, always_2d=False)
            if isinstance(data, np.ndarray):
                if data.ndim > 1:
                    data = data.mean(axis=1)
                return data.astype(np.float32), int(sr)
        except Exception:
            pass
    try:
        with wave.open(path, "rb") as w:
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
    except Exception:
        return None


def analyze_audio(path: str) -> AudioReport:
    signals: Dict[str, Dict] = {}
    data_sr = _read_audio_wave(path)

    if data_sr is None:
        # Can't read — give low-confidence inconclusive verdict
        return AudioReport(
            ai_probability=0.5,
            confidence=0.2,
            verdict="inconclusive",
            reasons="Unable to decode audio with built-in tools. For full analysis, install librosa and soundfile.",
            signals={"decoder": {"score": 0.5, "reason": "Decoder fallback used", "details": {"path": os.path.basename(path)}}},
        )

    data, sr = data_sr
    if len(data) == 0:
        return AudioReport(0.5, 0.2, "inconclusive", "Empty audio stream", {})

    # ---- Signal 1: dynamic range ----
    rms = float(np.sqrt(np.mean(data ** 2)))
    peak = float(np.max(np.abs(data)))
    crest = peak / (rms + 1e-9)
    s1 = 0.6 if crest < 3.0 else 0.3
    r1 = (
        "Crest factor is low — voice sounds unusually compressed (common in TTS/vocoders)"
        if s1 > 0.5
        else "Crest factor is within natural range"
    )
    signals["dynamics"] = {"score": s1, "reason": r1, "details": {"rms": round(rms, 4), "crest": round(crest, 3)}}

    # ---- Signal 2: spectral flatness over frames (rough) ----
    # FFT over short frames
    frame = 1024
    if len(data) >= frame * 4:
        nframes = len(data) // frame
        flats = []
        for i in range(min(nframes, 256)):
            seg = data[i * frame:(i + 1) * frame]
            spec = np.abs(np.fft.rfft(seg * np.hanning(frame))) + 1e-9
            gm = np.exp(np.log(spec).mean())
            am = spec.mean()
            flats.append(gm / am)
        flat = float(np.mean(flats))
    else:
        flat = 0.3
    s2 = 0.65 if 0.08 < flat < 0.18 else 0.35
    r2 = (
        "Spectral flatness falls in a band commonly produced by neural vocoders"
        if s2 > 0.5
        else "Spectral flatness looks natural"
    )
    signals["spectral_flatness"] = {"score": s2, "reason": r2, "details": {"value": round(flat, 4)}}

    # ---- Signal 3: high-frequency roll-off ----
    full_spec = np.abs(np.fft.rfft(data[: min(len(data), sr * 5)])) + 1e-9
    freqs = np.linspace(0, sr / 2, len(full_spec))
    hf_mask = freqs > 6000
    hf_energy = float(full_spec[hf_mask].mean()) / float(full_spec.mean() + 1e-9)
    s3 = 0.7 if hf_energy < 0.15 else 0.3
    r3 = (
        "High-frequency energy is unusually attenuated (bandwidth-limited TTS signature)"
        if s3 > 0.5
        else "High-frequency content looks natural"
    )
    signals["hf_rolloff"] = {"score": s3, "reason": r3, "details": {"hf_ratio": round(hf_energy, 4)}}

    # ---- Signal 4: zero-crossing variability ----
    window = min(len(data), max(sr // 2, 2048))
    if window >= 1024:
        zcr_values = []
        hop = max(512, window // 4)
        for start in range(0, max(1, len(data) - window), hop):
            seg = data[start:start + window]
            zcr = np.mean(np.abs(np.diff(np.signbit(seg).astype(np.int8))))
            zcr_values.append(float(zcr))
        zcr_mean = float(np.mean(zcr_values)) if zcr_values else 0.0
        zcr_std = float(np.std(zcr_values)) if zcr_values else 0.0
    else:
        zcr_mean, zcr_std = 0.0, 0.0

    s4 = 0.62 if zcr_std < 0.015 and zcr_mean < 0.18 else 0.32
    r4 = (
        "Zero-crossing pattern is overly uniform, which can happen in synthesized speech"
        if s4 > 0.5
        else "Temporal waveform variation looks natural"
    )
    signals["waveform_consistency"] = {
        "score": s4,
        "reason": r4,
        "details": {"zcr_mean": round(zcr_mean, 4), "zcr_std": round(zcr_std, 4)},
    }

    # Weighted ensemble
    w = {"dynamics": 0.24, "spectral_flatness": 0.28, "hf_rolloff": 0.28, "waveform_consistency": 0.20}
    prob = sum(signals[k]["score"] * w[k] for k in w)
    scores = np.array([signals[k]["score"] for k in w])
    confidence = float(max(0.3, 1.0 - scores.std()))
    if prob >= 0.6:
        verdict = "likely_ai"
    elif prob <= 0.35:
        verdict = "likely_real"
    else:
        verdict = "inconclusive"

    ranked = sorted(signals.items(), key=lambda kv: kv[1]["score"], reverse=True)
    reasons = " • ".join([v["reason"] for _, v in ranked[:2]])

    return AudioReport(
        ai_probability=round(prob, 3),
        confidence=round(confidence, 3),
        verdict=verdict,
        reasons=reasons,
        signals=signals,
    )
