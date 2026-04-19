"""
Video forensic analysis using OpenCV.
Samples frames across the video, runs image detection on each, and also
computes temporal signals (frame-to-frame consistency, flicker).
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Dict, List
import os
import tempfile
import numpy as np
import cv2
from PIL import Image

from app.ml.image_detector import analyze_image


@dataclass
class VideoReport:
    ai_probability: float
    confidence: float
    verdict: str
    reasons: str
    signals: Dict[str, Dict] = field(default_factory=dict)
    frame_timeline: List[Dict] = field(default_factory=list)


def _sample_frames(path: str, max_samples: int = 8) -> List[tuple[float, np.ndarray]]:
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        return []
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    if total <= 0:
        cap.release()
        return []
    step = max(1, total // max_samples)
    frames = []
    idx = 0
    while idx < total and len(frames) < max_samples:
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ok, frame = cap.read()
        if ok:
            timestamp = idx / fps
            frames.append((timestamp, cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)))
        idx += step
    cap.release()
    return frames


def _temporal_consistency(frames: List[np.ndarray]) -> tuple[float, str, dict]:
    if len(frames) < 2:
        return 0.5, "Not enough frames for temporal analysis", {"frames": len(frames)}
    diffs = []
    for i in range(1, len(frames)):
        a = cv2.cvtColor(frames[i - 1], cv2.COLOR_RGB2GRAY).astype(np.float32)
        b = cv2.cvtColor(frames[i], cv2.COLOR_RGB2GRAY).astype(np.float32)
        h = min(a.shape[0], b.shape[0], 240)
        w = min(a.shape[1], b.shape[1], 426)
        a = cv2.resize(a, (w, h))
        b = cv2.resize(b, (w, h))
        diffs.append(float(np.mean(np.abs(a - b))))
    diffs_arr = np.asarray(diffs)
    mean_diff = float(diffs_arr.mean())
    std_diff = float(diffs_arr.std())
    if std_diff / (mean_diff + 1e-6) > 1.5:
        score = 0.65
        reason = "Frame-to-frame variance is erratic — possible temporal inconsistency"
    elif mean_diff < 2.0:
        score = 0.55
        reason = "Frames are almost identical — possibly frozen or synthetic loop"
    else:
        score = 0.30
        reason = "Temporal transitions look natural"
    return score, reason, {"mean_diff": round(mean_diff, 3), "std_diff": round(std_diff, 3)}


def analyze_video(path: str) -> VideoReport:
    samples = _sample_frames(path, max_samples=8)
    if not samples:
        return VideoReport(
            ai_probability=0.5,
            confidence=0.2,
            verdict="inconclusive",
            reasons="Unable to decode video frames",
            signals={},
        )

    timeline = []
    frame_scores = []
    raw_frames = []

    with tempfile.TemporaryDirectory() as tmp:
        for i, (ts, frame) in enumerate(samples):
            p = os.path.join(tmp, f"f{i}.jpg")
            Image.fromarray(frame).save(p, "JPEG", quality=92)
            try:
                report = analyze_image(p)
                frame_scores.append(report.ai_probability)
                timeline.append({
                    "timestamp": round(ts, 2),
                    "ai_probability": report.ai_probability,
                    "verdict": report.verdict,
                })
                raw_frames.append(frame)
            except Exception as e:
                timeline.append({"timestamp": round(ts, 2), "error": str(e)})

    if not frame_scores:
        return VideoReport(0.5, 0.2, "inconclusive", "Frame analysis failed", {}, timeline)

    s_frame_mean = float(np.mean(frame_scores))
    s_frame_std = float(np.std(frame_scores))
    s_frame_peak = float(np.percentile(frame_scores, 75))
    s_temp, r_temp, d_temp = _temporal_consistency(raw_frames)

    signals = {
        "frame_ensemble": {
            "score": s_frame_mean,
            "reason": f"Average per-frame AI probability across {len(frame_scores)} samples",
            "details": {
                "mean": round(s_frame_mean, 3),
                "p75": round(s_frame_peak, 3),
                "std": round(s_frame_std, 3),
                "samples": len(frame_scores),
            },
        },
        "temporal": {"score": s_temp, "reason": r_temp, "details": d_temp},
    }

    consensus_bonus = 0.12 if s_frame_peak >= 0.62 and s_frame_mean >= 0.48 else 0.0
    prob = min(1.0, s_frame_mean * 0.62 + s_frame_peak * 0.18 + s_temp * 0.20 + consensus_bonus)
    confidence = max(0.35, min(0.96, 0.45 + (1.0 - s_frame_std) * 0.35 + abs(prob - 0.5) * 0.25))

    if prob >= 0.6:
        verdict = "likely_ai"
    elif prob <= 0.35:
        verdict = "likely_real"
    else:
        verdict = "inconclusive"

    ranked = sorted(signals.items(), key=lambda kv: kv[1]["score"], reverse=True)
    reasons = " • ".join([v["reason"] for _, v in ranked[:2]])

    return VideoReport(
        ai_probability=round(prob, 3),
        confidence=round(confidence, 3),
        verdict=verdict,
        reasons=reasons,
        signals=signals,
        frame_timeline=timeline,
    )
