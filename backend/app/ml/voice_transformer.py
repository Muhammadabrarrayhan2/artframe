"""
Voice transformation utilities for demo gender/age modification.
Uses librosa-based pitch shaping plus spectral tilting to make presets clearer.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import librosa
import numpy as np


@dataclass
class VoiceTransformConfig:
    pitch_shift: float = 0.0
    speed: float = 1.0
    formant_shift: float = 0.0
    depth: float = 1.0
    brightness: float = 0.0
    tremolo_rate: float = 0.0
    tremolo_depth: float = 0.0
    harmonic_drive: float = 0.0


class VoiceTransformer:
    """Demo voice transformation using pitch, time, and spectral shaping."""

    @staticmethod
    def _ensure_length(audio: np.ndarray, target_length: int) -> np.ndarray:
        if len(audio) == target_length:
            return audio.astype(np.float32)
        return librosa.util.fix_length(audio.astype(np.float32), size=target_length)

    @staticmethod
    def _normalize(audio: np.ndarray) -> np.ndarray:
        peak = float(np.max(np.abs(audio))) if len(audio) else 0.0
        if peak > 0.98:
            audio = audio / peak * 0.98
        return np.clip(audio, -1.0, 1.0).astype(np.float32)

    @staticmethod
    def shift_pitch(audio: np.ndarray, semitones: float, sr: int) -> np.ndarray:
        if abs(semitones) < 1e-3:
            return audio.astype(np.float32)
        shifted = librosa.effects.pitch_shift(audio.astype(np.float32), sr=sr, n_steps=semitones)
        return shifted.astype(np.float32)

    @staticmethod
    def change_speed(audio: np.ndarray, factor: float) -> np.ndarray:
        if abs(factor - 1.0) < 1e-3:
            return audio.astype(np.float32)
        stretched = librosa.effects.time_stretch(audio.astype(np.float32), rate=factor)
        return stretched.astype(np.float32)

    @staticmethod
    def apply_formant_shift(audio: np.ndarray, shift: float, sr: int) -> np.ndarray:
        if abs(shift) < 1e-3:
            return audio.astype(np.float32)
        factor = float(np.clip(2 ** (shift * 0.22), 0.72, 1.38))
        warped_sr = max(4000, int(sr * factor))
        warped = librosa.resample(audio.astype(np.float32), orig_sr=sr, target_sr=warped_sr)
        warped = VoiceTransformer._ensure_length(warped, len(audio))
        restore_steps = -12.0 * np.log2(max(factor, 1e-3))
        rebuilt = librosa.effects.pitch_shift(warped.astype(np.float32), sr=sr, n_steps=restore_steps)
        rebuilt = VoiceTransformer._ensure_length(rebuilt, len(audio))

        n_fft = 1024
        hop = 256
        stft = librosa.stft(rebuilt.astype(np.float32), n_fft=n_fft, hop_length=hop)
        magnitude, phase = np.abs(stft), np.angle(stft)
        freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft).astype(np.float32)
        normalized = np.clip(freqs / max(sr / 2, 1), 0.0, 1.0)
        tilt = np.exp(shift * (normalized - 0.2) * 2.4).astype(np.float32)
        weights = np.clip(tilt, 0.3, 3.0).reshape(-1, 1)
        rebuilt = librosa.istft(magnitude * weights * np.exp(1j * phase), hop_length=hop, length=len(audio))
        return rebuilt.astype(np.float32)

    @staticmethod
    def apply_voice_profile(audio: np.ndarray, sr: int, brightness: float) -> np.ndarray:
        if abs(brightness) < 1e-3:
            return audio.astype(np.float32)

        n_fft = 1024
        hop = 256
        stft = librosa.stft(audio.astype(np.float32), n_fft=n_fft, hop_length=hop)
        magnitude, phase = np.abs(stft), np.angle(stft)
        freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft).astype(np.float32)

        low_cut = 1.0 - max(0.0, brightness) * np.exp(-0.5 * ((freqs - 180.0) / 140.0) ** 2) * 0.45
        high_boost = 1.0 + brightness * np.exp(-0.5 * ((freqs - 3200.0) / 1600.0) ** 2) * 0.55
        upper_air = 1.0 + brightness * np.exp(-0.5 * ((freqs - 5200.0) / 2200.0) ** 2) * 0.25
        weights = np.clip(low_cut * high_boost * upper_air, 0.35, 2.4).reshape(-1, 1)

        transformed = magnitude * weights * np.exp(1j * phase)
        rebuilt = librosa.istft(transformed, hop_length=hop, length=len(audio))
        return rebuilt.astype(np.float32)

    @staticmethod
    def apply_presence_contour(audio: np.ndarray, sr: int, contour: float) -> np.ndarray:
        if abs(contour) < 1e-3:
            return audio.astype(np.float32)

        n_fft = 1024
        hop = 256
        stft = librosa.stft(audio.astype(np.float32), n_fft=n_fft, hop_length=hop)
        magnitude, phase = np.abs(stft), np.angle(stft)
        freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft).astype(np.float32)

        low_body = np.exp(-0.5 * ((freqs - 220.0) / 180.0) ** 2)
        presence = np.exp(-0.5 * ((freqs - 2400.0) / 1200.0) ** 2)
        air = np.exp(-0.5 * ((freqs - 5200.0) / 1800.0) ** 2)
        weights = 1.0 + contour * (presence * 0.7 + air * 0.3 - low_body * 0.45)
        weights = np.clip(weights, 0.28, 2.8).reshape(-1, 1)

        rebuilt = librosa.istft(magnitude * weights * np.exp(1j * phase), hop_length=hop, length=len(audio))
        return rebuilt.astype(np.float32)

    @staticmethod
    def apply_tremolo(audio: np.ndarray, sr: int, rate: float, depth: float) -> np.ndarray:
        if rate <= 0 or depth <= 0:
            return audio.astype(np.float32)
        t = np.arange(len(audio), dtype=np.float32) / max(sr, 1)
        lfo = 1.0 - depth * 0.5 + depth * 0.5 * np.sin(2 * np.pi * rate * t)
        return (audio.astype(np.float32) * lfo).astype(np.float32)

    @staticmethod
    def apply_harmonic_drive(audio: np.ndarray, drive: float) -> np.ndarray:
        if drive <= 0:
            return audio.astype(np.float32)
        gain = 1.0 + drive * 4.0
        return np.tanh(audio.astype(np.float32) * gain).astype(np.float32)

    @staticmethod
    def transform(
        audio: np.ndarray,
        sr: int,
        preset: Literal["male_to_female", "female_to_male", "younger", "older"] | None = None,
        config: VoiceTransformConfig | None = None,
    ) -> np.ndarray:
        if config is None:
            config = VoiceTransformConfig()
            if preset == "male_to_female":
                config.pitch_shift = 11.0
                config.formant_shift = 1.45
                config.speed = 1.12
                config.brightness = 1.35
                config.harmonic_drive = 0.08
                config.depth = 1.0
            elif preset == "female_to_male":
                config.pitch_shift = -10.0
                config.formant_shift = -1.35
                config.speed = 0.88
                config.brightness = -1.25
                config.harmonic_drive = 0.2
                config.depth = 1.0
            elif preset == "younger":
                config.pitch_shift = 13.5
                config.formant_shift = 1.55
                config.speed = 1.22
                config.brightness = 1.45
                config.tremolo_rate = 6.5
                config.tremolo_depth = 0.08
                config.depth = 1.0
            elif preset == "older":
                config.pitch_shift = -7.5
                config.formant_shift = -1.0
                config.speed = 0.82
                config.brightness = -0.95
                config.tremolo_rate = 4.0
                config.tremolo_depth = 0.06
                config.harmonic_drive = 0.12
                config.depth = 1.0

        source = np.asarray(audio, dtype=np.float32).flatten()
        if len(source) == 0:
            return source

        result = source.copy()
        if abs(config.speed - 1.0) > 1e-3:
            result = VoiceTransformer.change_speed(result, config.speed)
            result = VoiceTransformer._ensure_length(result, len(source))

        if abs(config.pitch_shift) > 1e-3:
            result = VoiceTransformer.shift_pitch(result, config.pitch_shift, sr)
            result = VoiceTransformer._ensure_length(result, len(source))

        if abs(config.formant_shift) > 1e-3:
            result = VoiceTransformer.apply_formant_shift(result, config.formant_shift, sr)
            result = VoiceTransformer._ensure_length(result, len(source))

        if abs(config.brightness) > 1e-3:
            result = VoiceTransformer.apply_voice_profile(result, sr, config.brightness)
            result = VoiceTransformer._ensure_length(result, len(source))

        contour = 0.0
        if preset in {"male_to_female", "younger"}:
            contour = 0.9 if preset == "male_to_female" else 1.05
        elif preset in {"female_to_male", "older"}:
            contour = -0.95 if preset == "female_to_male" else -0.7
        if abs(contour) > 1e-3:
            result = VoiceTransformer.apply_presence_contour(result, sr, contour)
            result = VoiceTransformer._ensure_length(result, len(source))

        if config.tremolo_rate > 0 and config.tremolo_depth > 0:
            result = VoiceTransformer.apply_tremolo(result, sr, config.tremolo_rate, config.tremolo_depth)
            result = VoiceTransformer._ensure_length(result, len(source))

        if config.harmonic_drive > 0:
            result = VoiceTransformer.apply_harmonic_drive(result, config.harmonic_drive)
            result = VoiceTransformer._ensure_length(result, len(source))

        depth = float(np.clip(config.depth, 0.0, 1.0))
        blended = source * (1.0 - depth) + result * depth
        return VoiceTransformer._normalize(blended)
