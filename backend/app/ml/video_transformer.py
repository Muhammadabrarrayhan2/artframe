"""
Face-aware video transformation utilities for demo appearance edits.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import cv2
import numpy as np


@dataclass
class VideoTransformConfig:
    gender_shift: float = 0.0
    age_shift: float = 0.0
    skin_smoothness: float = 0.0
    eyes_enhancement: float = 0.0
    face_shape: float = 0.0
    brightness: float = 0.0
    saturation: float = 0.0
    style: Literal["original", "enhance", "artistic", "cartoon"] = "original"


class VideoTransformer:
    """Transform video frames for demo appearance edits."""

    _face_cascade = cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    )
    _eye_cascade = cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_eye.xml"
    )

    @staticmethod
    def process_frame(frame: np.ndarray, config: VideoTransformConfig) -> np.ndarray:
        working = frame.copy()
        working = VideoTransformer._apply_global_adjustments(working, config)

        gray = cv2.cvtColor(working, cv2.COLOR_BGR2GRAY)
        faces = VideoTransformer._detect_faces(gray)
        if faces:
            for (x, y, w, h) in faces:
                VideoTransformer._apply_face_profile(working, gray, x, y, w, h, config)
        else:
            working = VideoTransformer._apply_global_fallback_profile(working, config)

        return np.clip(working, 0, 255).astype(np.uint8)

    @staticmethod
    def _detect_faces(gray: np.ndarray) -> list[tuple[int, int, int, int]]:
        if VideoTransformer._face_cascade.empty():
            return []
        detected = VideoTransformer._face_cascade.detectMultiScale(
            gray,
            scaleFactor=1.15,
            minNeighbors=5,
            minSize=(72, 72),
        )
        return [tuple(map(int, face)) for face in detected]

    @staticmethod
    def _apply_global_adjustments(frame: np.ndarray, config: VideoTransformConfig) -> np.ndarray:
        result = frame.astype(np.float32)
        if config.skin_smoothness > 0:
            sigma = 10 + config.skin_smoothness * 22
            smoothed = cv2.bilateralFilter(result.astype(np.uint8), 9, sigma, sigma).astype(np.float32)
            result = cv2.addWeighted(result, 1.0 - config.skin_smoothness * 0.55, smoothed, config.skin_smoothness * 0.55, 0)

        hsv = cv2.cvtColor(np.clip(result, 0, 255).astype(np.uint8), cv2.COLOR_BGR2HSV).astype(np.float32)
        hsv[..., 1] *= 1.0 + config.saturation * 0.45
        hsv[..., 2] *= 1.0 + config.brightness * 0.35
        hsv[..., 1] = np.clip(hsv[..., 1], 0, 255)
        hsv[..., 2] = np.clip(hsv[..., 2], 0, 255)
        result = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR).astype(np.float32)

        if config.style == "enhance":
            blurred = cv2.GaussianBlur(result, (0, 0), 2.2)
            result = cv2.addWeighted(result, 1.25, blurred, -0.25, 0)
        elif config.style == "artistic":
            smooth = cv2.stylization(np.clip(result, 0, 255).astype(np.uint8), sigma_s=30, sigma_r=0.16)
            result = cv2.addWeighted(result, 0.55, smooth.astype(np.float32), 0.45, 0)
        elif config.style == "cartoon":
            frame_u8 = np.clip(result, 0, 255).astype(np.uint8)
            # Multi-pass bilateral for flat cartoon skin
            smooth = cv2.bilateralFilter(frame_u8, 9, 80, 80)
            smooth = cv2.bilateralFilter(smooth, 9, 60, 60)
            # Color quantization — reduces to ~8 flat tones per channel
            quant = ((smooth.astype(np.float32) / 32).astype(np.uint8) * 32).astype(np.float32)
            # Boost saturation for vivid cartoon look
            hsv_q = cv2.cvtColor(np.clip(quant, 0, 255).astype(np.uint8), cv2.COLOR_BGR2HSV).astype(np.float32)
            hsv_q[..., 1] = np.clip(hsv_q[..., 1] * 1.55, 0, 255)
            quant = cv2.cvtColor(hsv_q.astype(np.uint8), cv2.COLOR_HSV2BGR).astype(np.float32)
            # Edge-based ink lines (white bg = 255, lines = 0)
            gray_s = cv2.cvtColor(smooth, cv2.COLOR_BGR2GRAY)
            edges = cv2.adaptiveThreshold(gray_s, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY, 9, 5)
            # Overlay edges (dark outlines) onto quantized color
            edge_mask = edges.astype(np.float32) / 255.0
            cartoon = quant * edge_mask[..., None]
            result = cv2.addWeighted(result, 0.15, cartoon, 0.85, 0)

        return result

    @staticmethod
    def _apply_face_profile(
        frame: np.ndarray,
        gray: np.ndarray,
        x: int,
        y: int,
        w: int,
        h: int,
        config: VideoTransformConfig,
    ) -> None:
        pad_x = int(w * 0.18)
        pad_y = int(h * 0.2)
        x0 = max(0, x - pad_x)
        y0 = max(0, y - pad_y)
        x1 = min(frame.shape[1], x + w + pad_x)
        y1 = min(frame.shape[0], y + h + pad_y)
        roi = frame[y0:y1, x0:x1].copy()
        roi_gray = gray[y0:y1, x0:x1]

        face_mask = VideoTransformer._elliptical_mask(roi.shape[:2], softness=0.78)

        if config.gender_shift < -0.05:
            roi = VideoTransformer._apply_feminine_profile(roi, roi_gray, face_mask, abs(config.gender_shift), config)
        elif config.gender_shift > 0.05:
            roi = VideoTransformer._apply_masculine_profile(roi, roi_gray, face_mask, config.gender_shift, config)

        if config.age_shift < -0.05:
            roi = VideoTransformer._apply_younger_profile(roi, face_mask, abs(config.age_shift), config)
        elif config.age_shift > 0.05:
            roi = VideoTransformer._apply_older_profile(roi, roi_gray, face_mask, config.age_shift, config)

        if config.eyes_enhancement > 0:
            if VideoTransformer._eye_cascade.empty():
                eyes = np.empty((0, 4), dtype=np.int32)
            else:
                eyes = VideoTransformer._eye_cascade.detectMultiScale(
                    roi_gray,
                    scaleFactor=1.12,
                    minNeighbors=4,
                    minSize=(18, 18),
                )
            roi = VideoTransformer._enhance_eye_regions(roi, eyes, config.eyes_enhancement)

        frame[y0:y1, x0:x1] = roi

    @staticmethod
    def _apply_feminine_profile(
        roi: np.ndarray,
        roi_gray: np.ndarray,
        mask: np.ndarray,
        strength: float,
        config: VideoTransformConfig,
    ) -> np.ndarray:
        result = roi.astype(np.float32)
        # Stronger bilateral smoothing for soft skin
        smooth = cv2.bilateralFilter(roi.astype(np.uint8), 11, 65 + strength * 50, 65 + strength * 50).astype(np.float32)
        smooth = cv2.bilateralFilter(np.clip(smooth, 0, 255).astype(np.uint8), 9, 45 + strength * 30, 45 + strength * 30).astype(np.float32)
        result = VideoTransformer._blend_masked(result, smooth, mask, 0.55 + strength * 0.32)

        # Warmer, more feminine skin tone + hue shift
        hsv = cv2.cvtColor(np.clip(result, 0, 255).astype(np.uint8), cv2.COLOR_BGR2HSV).astype(np.float32)
        hsv[..., 1] *= 1.08 + strength * 0.22
        hsv[..., 2] *= 1.06 + strength * 0.14
        hsv[..., 0] = (hsv[..., 0] - 3 * strength) % 180
        result = cv2.cvtColor(np.clip(hsv, 0, 255).astype(np.uint8), cv2.COLOR_HSV2BGR).astype(np.float32)

        # Pink/rose tint on face
        result = VideoTransformer._add_color_tint(result, mask, np.array([28, 14, 70], dtype=np.float32), 0.10 + strength * 0.14)
        # Prominent cheek blush
        result = VideoTransformer._add_cheek_highlights(result, strength * 1.4, warm=True)
        # Brighten upper face (foundation-like lift)
        h, w = roi.shape[:2]
        upper_mask = np.zeros((h, w), dtype=np.float32)
        upper_mask[: int(h * 0.6), :] = 1.0
        upper_mask = cv2.GaussianBlur(upper_mask, (0, 0), h * 0.12 + 4)
        combined = mask * upper_mask
        result = VideoTransformer._blend_masked(result, result * (1.0 + strength * 0.12), combined, 0.6)
        return result

    @staticmethod
    def _apply_masculine_profile(
        roi: np.ndarray,
        roi_gray: np.ndarray,
        mask: np.ndarray,
        strength: float,
        config: VideoTransformConfig,
    ) -> np.ndarray:
        result = roi.astype(np.float32)
        # Strong edge sharpening for defined features
        detail = cv2.GaussianBlur(result, (0, 0), 1.6)
        result = cv2.addWeighted(result, 1.28 + strength * 0.18, detail, -0.28 - strength * 0.18, 0)

        # Desaturate + cool skin tone
        hsv = cv2.cvtColor(np.clip(result, 0, 255).astype(np.uint8), cv2.COLOR_BGR2HSV).astype(np.float32)
        hsv[..., 1] *= 0.88 - strength * 0.18
        hsv[..., 2] *= 0.95 - strength * 0.10
        result = cv2.cvtColor(np.clip(hsv, 0, 255).astype(np.uint8), cv2.COLOR_HSV2BGR).astype(np.float32)

        # Cooler / olive tint
        result = VideoTransformer._add_color_tint(result, mask, np.array([12, 5, -18], dtype=np.float32), 0.08 + strength * 0.12)
        # Prominent jaw and face structure shadows
        result = VideoTransformer._add_jaw_shadow(result, strength * 1.3)
        # Temple / brow shadow for masculine brow structure
        h, w = roi.shape[:2]
        brow_mask = np.zeros((h, w), dtype=np.float32)
        cv2.ellipse(brow_mask, (w // 2, int(h * 0.22)), (max(10, int(w * 0.36)), max(6, int(h * 0.09))), 0, 0, 360, 1.0, -1)
        brow_mask = cv2.GaussianBlur(brow_mask, (0, 0), max(w, h) * 0.05 + 2)
        result -= np.array([10, 9, 8], dtype=np.float32) * brow_mask[..., None] * mask[..., None] * (0.18 + strength * 0.18)
        return result

    @staticmethod
    def _apply_younger_profile(
        roi: np.ndarray,
        mask: np.ndarray,
        strength: float,
        config: VideoTransformConfig,
    ) -> np.ndarray:
        result = roi.astype(np.float32)
        smooth = cv2.bilateralFilter(roi.astype(np.uint8), 9, 55 + strength * 45, 55 + strength * 45).astype(np.float32)
        result = VideoTransformer._blend_masked(result, smooth, mask, 0.34 + strength * 0.34)

        hsv = cv2.cvtColor(np.clip(result, 0, 255).astype(np.uint8), cv2.COLOR_BGR2HSV).astype(np.float32)
        hsv[..., 1] *= 1.05 + strength * 0.1
        hsv[..., 2] *= 1.05 + strength * 0.12
        result = cv2.cvtColor(np.clip(hsv, 0, 255).astype(np.uint8), cv2.COLOR_HSV2BGR).astype(np.float32)
        return result

    @staticmethod
    def _apply_older_profile(
        roi: np.ndarray,
        roi_gray: np.ndarray,
        mask: np.ndarray,
        strength: float,
        config: VideoTransformConfig,
    ) -> np.ndarray:
        result = roi.astype(np.float32)

        hsv = cv2.cvtColor(np.clip(result, 0, 255).astype(np.uint8), cv2.COLOR_BGR2HSV).astype(np.float32)
        hsv[..., 1] *= 0.95 - strength * 0.15
        hsv[..., 2] *= 0.95 - strength * 0.1
        result = cv2.cvtColor(np.clip(hsv, 0, 255).astype(np.uint8), cv2.COLOR_HSV2BGR).astype(np.float32)

        wrinkle = cv2.Laplacian(roi_gray, cv2.CV_32F, ksize=3)
        wrinkle = cv2.GaussianBlur(np.abs(wrinkle), (0, 0), 1.2)
        wrinkle = cv2.normalize(wrinkle, None, 0, 1, cv2.NORM_MINMAX)
        wrinkle = np.repeat(wrinkle[..., None], 3, axis=2)
        result = result - wrinkle * (18 + 30 * strength) * mask[..., None]
        result = VideoTransformer._add_under_eye_shadow(result, strength)
        return result

    @staticmethod
    def _enhance_eye_regions(
        roi: np.ndarray,
        eyes: tuple[np.ndarray, ...] | np.ndarray,
        intensity: float,
    ) -> np.ndarray:
        result = roi.astype(np.float32)
        if len(eyes) == 0:
            h, w = roi.shape[:2]
            eyes = np.array(
                [
                    [int(w * 0.26), int(h * 0.24), int(w * 0.16), int(h * 0.12)],
                    [int(w * 0.58), int(h * 0.24), int(w * 0.16), int(h * 0.12)],
                ]
            )

        for (x, y, w, h) in eyes[:2]:
            mask = VideoTransformer._soft_rect_mask(result.shape[:2], x, y, w, h, padding=0.8)
            lift = np.full_like(result, (18, 14, 10), dtype=np.float32)
            result = VideoTransformer._blend_masked(result, result + lift, mask, 0.18 + intensity * 0.25)

        return result

    @staticmethod
    def _apply_global_fallback_profile(frame: np.ndarray, config: VideoTransformConfig) -> np.ndarray:
        result = frame.astype(np.float32)
        if config.gender_shift < -0.05:
            result[..., 2] *= 1.06
            result[..., 0] *= 0.95
        elif config.gender_shift > 0.05:
            result[..., 1] *= 0.96
            result[..., 2] *= 0.95

        if config.age_shift < -0.05:
            blur = cv2.GaussianBlur(result, (0, 0), 1.6)
            result = cv2.addWeighted(result, 0.8, blur, 0.2, 6)
        elif config.age_shift > 0.05:
            detail = cv2.GaussianBlur(result, (0, 0), 2.0)
            result = cv2.addWeighted(result, 1.18, detail, -0.18, -6)

        return result

    @staticmethod
    def _simple_process_frame(frame: np.ndarray, config: VideoTransformConfig) -> np.ndarray:
        result = frame.astype(np.float32)
        if config.gender_shift < -0.05:
            result[..., 2] *= 1.08
            result[..., 1] *= 1.02
            result[..., 0] *= 0.94
        elif config.gender_shift > 0.05:
            result[..., 2] *= 0.94
            result[..., 1] *= 0.97
            result[..., 0] *= 1.03

        if config.age_shift < -0.05:
            blur = cv2.GaussianBlur(result, (0, 0), 1.8)
            result = cv2.addWeighted(result, 0.82, blur, 0.18, 8)
        elif config.age_shift > 0.05:
            detail = cv2.GaussianBlur(result, (0, 0), 2.2)
            result = cv2.addWeighted(result, 1.2, detail, -0.2, -6)

        if config.saturation != 0 or config.brightness != 0:
            hsv = cv2.cvtColor(np.clip(result, 0, 255).astype(np.uint8), cv2.COLOR_BGR2HSV).astype(np.float32)
            hsv[..., 1] *= 1.0 + config.saturation * 0.35
            hsv[..., 2] *= 1.0 + config.brightness * 0.25
            result = cv2.cvtColor(np.clip(hsv, 0, 255).astype(np.uint8), cv2.COLOR_HSV2BGR).astype(np.float32)

        return np.clip(result, 0, 255).astype(np.uint8)

    @staticmethod
    def _blend_masked(base: np.ndarray, target: np.ndarray, mask: np.ndarray, alpha: float) -> np.ndarray:
        alpha_mask = np.clip(mask[..., None] * alpha, 0.0, 1.0)
        return base * (1.0 - alpha_mask) + target * alpha_mask

    @staticmethod
    def _elliptical_mask(shape: tuple[int, int], softness: float = 0.8) -> np.ndarray:
        h, w = shape
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        cx = w / 2
        cy = h / 2
        rx = w * 0.42
        ry = h * 0.48
        ellipse = ((xx - cx) / max(rx, 1)) ** 2 + ((yy - cy) / max(ry, 1)) ** 2
        mask = np.clip(1.0 - ellipse, 0.0, 1.0)
        mask = cv2.GaussianBlur(mask, (0, 0), max(w, h) * (1.0 - softness) * 0.08 + 3)
        return np.clip(mask, 0.0, 1.0)

    @staticmethod
    def _soft_rect_mask(
        shape: tuple[int, int],
        x: int,
        y: int,
        w: int,
        h: int,
        padding: float = 0.6,
    ) -> np.ndarray:
        height, width = shape
        mask = np.zeros((height, width), dtype=np.float32)
        pad_x = int(w * padding)
        pad_y = int(h * padding)
        x0 = max(0, x - pad_x)
        y0 = max(0, y - pad_y)
        x1 = min(width, x + w + pad_x)
        y1 = min(height, y + h + pad_y)
        mask[y0:y1, x0:x1] = 1.0
        sigma = max(w, h) * 0.35
        return cv2.GaussianBlur(mask, (0, 0), sigma)

    @staticmethod
    def _add_color_tint(
        image: np.ndarray,
        mask: np.ndarray,
        tint_bgr: np.ndarray,
        strength: float,
    ) -> np.ndarray:
        tint = np.zeros_like(image, dtype=np.float32)
        tint[:] = tint_bgr
        return image + tint * mask[..., None] * strength

    @staticmethod
    def _add_cheek_highlights(image: np.ndarray, strength: float, warm: bool) -> np.ndarray:
        h, w = image.shape[:2]
        cheek_color = np.array([20, 28, 55], dtype=np.float32) if warm else np.array([18, 16, 22], dtype=np.float32)
        for center_x in (0.3, 0.7):
            mask = np.zeros((h, w), dtype=np.float32)
            cv2.ellipse(
                mask,
                (int(w * center_x), int(h * 0.58)),
                (max(8, int(w * 0.1)), max(6, int(h * 0.06))),
                0,
                0,
                360,
                1.0,
                -1,
            )
            mask = cv2.GaussianBlur(mask, (0, 0), max(w, h) * 0.05 + 2)
            image += cheek_color * mask[..., None] * (0.08 + strength * 0.07)
        return image

    @staticmethod
    def _add_jaw_shadow(image: np.ndarray, strength: float) -> np.ndarray:
        h, w = image.shape[:2]
        mask = np.zeros((h, w), dtype=np.float32)
        cv2.ellipse(
            mask,
            (w // 2, int(h * 0.78)),
            (max(10, int(w * 0.22)), max(8, int(h * 0.1))),
            0,
            0,
            360,
            1.0,
            -1,
        )
        mask = cv2.GaussianBlur(mask, (0, 0), max(w, h) * 0.06 + 2)
        shadow = np.array([-18, -16, -16], dtype=np.float32)
        image += shadow * mask[..., None] * (0.22 + strength * 0.12)
        return image

    @staticmethod
    def _add_under_eye_shadow(image: np.ndarray, strength: float) -> np.ndarray:
        h, w = image.shape[:2]
        for center_x in (0.34, 0.66):
            mask = np.zeros((h, w), dtype=np.float32)
            cv2.ellipse(
                mask,
                (int(w * center_x), int(h * 0.4)),
                (max(8, int(w * 0.08)), max(4, int(h * 0.04))),
                0,
                0,
                360,
                1.0,
                -1,
            )
            mask = cv2.GaussianBlur(mask, (0, 0), max(w, h) * 0.03 + 1.5)
            image -= np.array([14, 12, 10], dtype=np.float32) * mask[..., None] * (0.18 + strength * 0.14)
        return image

    @staticmethod
    def transform_video(
        input_path: str,
        output_path: str,
        config: VideoTransformConfig,
        progress_callback=None,
    ) -> bool:
        cap = cv2.VideoCapture(input_path)
        if not cap.isOpened():
            return False

        fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
        if width <= 0 or height <= 0:
            cap.release()
            return False

        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        out = cv2.VideoWriter(output_path, fourcc, fps, (width, height))
        if not out.isOpened():
            cap.release()
            return False

        frame_count = 0
        failed_frames = 0
        try:
            while True:
                ret, frame = cap.read()
                if not ret:
                    break

                try:
                    transformed = VideoTransformer.process_frame(frame, config)
                except Exception:
                    failed_frames += 1
                    transformed = VideoTransformer._simple_process_frame(frame, config)
                out.write(transformed)

                frame_count += 1
                if progress_callback:
                    progress_callback(frame_count / total_frames)
        except Exception:
            cap.release()
            out.release()
            return False
        finally:
            cap.release()
            out.release()

        return frame_count > 0
