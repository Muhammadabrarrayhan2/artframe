from __future__ import annotations

import base64
import json
import mimetypes
import urllib.error
import urllib.request
from dataclasses import dataclass

from app.core.config import settings


@dataclass
class VoiceConversionResponse:
    audio_bytes: bytes
    mime_type: str
    engine: str
    provider_mode: str
    model_id: str | None = None


class VoiceConversionProviderError(RuntimeError):
    pass


class VoiceConversionService:
    MODEL_BY_PRESET = {
        "male_to_female": "VOICE_MODEL_MALE_TO_FEMALE",
        "female_to_male": "VOICE_MODEL_FEMALE_TO_MALE",
        "younger": "VOICE_MODEL_YOUNGER",
        "older": "VOICE_MODEL_OLDER",
    }

    @staticmethod
    def provider_enabled() -> bool:
        return (
            settings.VOICE_CONVERSION_PROVIDER.lower() != "local"
            and bool(settings.VOICE_CONVERSION_ENDPOINT.strip())
        )

    @staticmethod
    def model_for_preset(preset: str) -> str | None:
        setting_name = VoiceConversionService.MODEL_BY_PRESET.get(preset)
        if not setting_name:
            return None
        value = getattr(settings, setting_name, "")
        return value.strip() or None

    @staticmethod
    def convert_with_provider(
        audio_bytes: bytes,
        filename: str,
        preset: str,
        sample_rate: int,
    ) -> VoiceConversionResponse:
        endpoint = settings.VOICE_CONVERSION_ENDPOINT.strip()
        if not endpoint:
            raise VoiceConversionProviderError("Voice conversion endpoint is not configured.")

        model_id = VoiceConversionService.model_for_preset(preset)
        if not model_id:
            raise VoiceConversionProviderError(
                f"No external voice model is configured for preset '{preset}'."
            )

        boundary = "----ArtFrameVoiceBoundary7MA4YWxkTrZu0gW"
        mime_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        payload = VoiceConversionService._build_multipart_body(
            boundary=boundary,
            fields={
                "preset": preset,
                "model_id": model_id,
                "sample_rate": str(sample_rate),
            },
            file_field_name="file",
            filename=filename,
            file_mime_type=mime_type,
            file_bytes=audio_bytes,
        )

        headers = {
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Accept": "application/json, audio/wav, audio/x-wav, audio/mpeg, audio/*",
        }
        if settings.VOICE_CONVERSION_TOKEN.strip():
            headers["Authorization"] = f"Bearer {settings.VOICE_CONVERSION_TOKEN.strip()}"

        request = urllib.request.Request(
            endpoint,
            data=payload,
            headers=headers,
            method="POST",
        )

        try:
            with urllib.request.urlopen(
                request,
                timeout=settings.VOICE_CONVERSION_TIMEOUT_SECONDS,
            ) as response:
                response_bytes = response.read()
                response_mime = response.headers.get_content_type()
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="ignore")
            raise VoiceConversionProviderError(
                f"External voice provider returned HTTP {exc.code}: {detail or exc.reason}"
            ) from exc
        except urllib.error.URLError as exc:
            raise VoiceConversionProviderError(
                f"External voice provider is unreachable: {exc.reason}"
            ) from exc

        return VoiceConversionService._parse_provider_response(
            response_bytes=response_bytes,
            response_mime=response_mime,
            provider_name=settings.VOICE_CONVERSION_PROVIDER.lower(),
            model_id=model_id,
        )

    @staticmethod
    def _build_multipart_body(
        boundary: str,
        fields: dict[str, str],
        file_field_name: str,
        filename: str,
        file_mime_type: str,
        file_bytes: bytes,
    ) -> bytes:
        lines: list[bytes] = []
        for key, value in fields.items():
            lines.extend(
                [
                    f"--{boundary}".encode(),
                    f'Content-Disposition: form-data; name="{key}"'.encode(),
                    b"",
                    value.encode("utf-8"),
                ]
            )

        lines.extend(
            [
                f"--{boundary}".encode(),
                (
                    f'Content-Disposition: form-data; name="{file_field_name}"; '
                    f'filename="{filename}"'
                ).encode(),
                f"Content-Type: {file_mime_type}".encode(),
                b"",
                file_bytes,
                f"--{boundary}--".encode(),
                b"",
            ]
        )
        return b"\r\n".join(lines)

    @staticmethod
    def _parse_provider_response(
        response_bytes: bytes,
        response_mime: str,
        provider_name: str,
        model_id: str,
    ) -> VoiceConversionResponse:
        if response_mime.startswith("audio/"):
            return VoiceConversionResponse(
                audio_bytes=response_bytes,
                mime_type=response_mime,
                engine=f"{provider_name}-voice-model",
                provider_mode="external-model",
                model_id=model_id,
            )

        try:
            payload = json.loads(response_bytes.decode("utf-8"))
        except Exception as exc:
            raise VoiceConversionProviderError(
                "External voice provider returned an unsupported response format."
            ) from exc

        audio_base64 = payload.get("audio_base64")
        if not audio_base64:
            raise VoiceConversionProviderError(
                "External voice provider response does not contain audio_base64."
            )

        return VoiceConversionResponse(
            audio_bytes=base64.b64decode(audio_base64),
            mime_type=payload.get("mime_type") or "audio/wav",
            engine=payload.get("engine") or f"{provider_name}-voice-model",
            provider_mode=payload.get("provider_mode") or "external-model",
            model_id=payload.get("model_id") or model_id,
        )
