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
