# ArtFrame — Gemini AI Lab Expansion Design
**Date:** 2026-04-19  
**Status:** Approved

---

## Overview

Expand the ArtFrame Lab with (1) 8 new manual image style filters, (2) a Gemini-powered AI Generate tab with text-to-image, AI image transform, and text-to-video. API key is stored globally in `backend/.env` — no per-user key management.

---

## Section 1: New Manual Image Styles

Added to `backend/app/api/lab.py` using NumPy + PIL only (no Gemini required).

| Style ID     | Name         | Effect                                                   |
|--------------|--------------|----------------------------------------------------------|
| `neon_glow`  | Neon Glow    | Edge detection + neon colors on dark background          |
| `anime`      | Anime Style  | Color quantization + thick edge overlay, bright palette  |
| `hdr`        | HDR Effect   | Local contrast boost, vivid shadows & highlights         |
| `pop_art`    | Pop Art      | Posterize + bold color blocks                            |
| `glitch`     | Glitch Art   | RGB channel shift + horizontal slice artifacts           |
| `thermal`    | Thermal Vision | COLORMAP_JET colormap (blue-green-red)                 |
| `blueprint`  | Blueprint    | Inverted edges, technical blue color                     |
| `infrared`   | Infrared     | Red/green channel swap + white glow                      |

Each style gets a preview card gradient in `STYLE_PREVIEWS` on the frontend.

---

## Section 2: API Key & Gemini Service

### API Key Storage
```
backend/.env
GEMINI_API_KEY=AIza...your-key-here
```
No database storage. Key is read from environment at runtime.

### New Files
- `backend/app/services/gemini_service.py` — wraps `google-generativeai` SDK
- `backend/app/api/lab_gemini.py` — FastAPI router for all Gemini endpoints

### GeminiService Methods
```python
is_configured() -> bool
generate_image(prompt: str, aspect: str) -> bytes          # PNG bytes
transform_image(image_bytes: bytes, instruction: str) -> bytes
generate_video_frames(prompt: str, n_frames: int) -> list[bytes]
```

### Models Used
- Image generation: `imagen-3.0-generate-002` with fallback to `gemini-2.0-flash`
- Image transform: `gemini-2.0-flash` (vision + generation)
- Video frames: `gemini-2.0-flash` (generate each frame as image)

### Status Endpoint
```
GET /api/v1/lab-gemini/status
→ { "configured": bool, "model": "gemini-2.0-flash" }
```

### Quota
- 10 AI generation credits per user per day (image + video combined)
- Tracked via existing `AuditLog` table, action = `"lab_ai_generate"`
- Quota checked before each generation request

---

## Section 3: AI Generate Tab

New fourth tab in the Lab page. Contains three sub-features in accordion layout.

### 3a — Text-to-Image
- **Input:** Prompt textarea (max 500 chars) + aspect ratio selector (Square / Landscape / Portrait)
- **Endpoint:** `POST /api/v1/lab-gemini/generate-image`
- **Body:** `{ prompt, aspect_ratio }`
- **Output:** Watermarked image (AI-GENERATED watermark applied server-side) + download button
- **Consent:** Single checkbox before generation

### 3b — AI Image Transform
- **Input:** Upload image + instruction textarea (max 300 chars, e.g. "make it Van Gogh style")
- **Endpoint:** `POST /api/v1/lab-gemini/transform-image`
- **Body:** FormData `{ file, instruction }`
- **Output:** Transformed image (watermarked) + download button
- **Model:** `gemini-2.0-flash` with vision input

### 3c — Text-to-Video
- **Input:** Prompt textarea (max 300 chars) + duration selector (3s / 5s)
- **Endpoint:** `POST /api/v1/lab-gemini/generate-video`
- **Body:** `{ prompt, duration_seconds }`
- **Processing:** Gemini generates 6 frames (3s) or 10 frames (5s) → OpenCV stitches at 2fps into MP4
- **Output:** Video player + download button
- **Limit:** 1 attempt per session (button locked after first attempt, cleared on page reload)
- **Disclaimer:** "Experimental — AI-generated frames stitched into video. Quality is illustrative."
- **Consent:** Two checkboxes (own content, AI label)

### Locked State (No API Key)
When `configured: false`, the entire AI Generate tab content is replaced with:
```
⚠️ AI generation is not configured.
To enable: add GEMINI_API_KEY=your-key to backend/.env and restart the server.
Get your key at: aistudio.google.com/app/apikey
```

### Quota Indicator
Small badge in AI Generate tab header: `"X/10 AI credits left today"`

---

## Architecture Summary

```
frontend/app/lab/page.tsx
  └── ImageTransformTab       (existing + 8 new styles)
  └── VoiceTransformTab       (existing, unchanged)
  └── VideoTransformTab       (existing, unchanged)
  └── AiGenerateTab [NEW]
        ├── TextToImageSection
        ├── AiImageTransformSection
        └── TextToVideoSection

backend/app/api/
  ├── lab.py                  (add 8 new transform functions)
  ├── lab_gemini.py [NEW]     (generate-image, transform-image, generate-video, status)
  └── lab_advanced.py         (unchanged)

backend/app/services/
  └── gemini_service.py [NEW] (GeminiService class)

backend/app/main.py           (register lab_gemini router)
backend/app/core/config.py    (add GEMINI_API_KEY setting)
backend/.env                  (add GEMINI_API_KEY=)
```

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| No API key in .env | Status endpoint returns `configured: false`, frontend shows setup banner |
| Gemini API error / quota exceeded | HTTP 503 with user-friendly message |
| Imagen model unavailable | Fallback to `gemini-2.0-flash` image generation |
| Video frame generation partial failure | Skip failed frames, stitch remaining (min 3 frames required) |
| File too large for AI transform | Resize to max 1024px before sending to Gemini |
| User daily quota exceeded | HTTP 429 "Daily AI credit limit reached" |

---

## Dependencies to Add

```
# backend/requirements.txt
google-generativeai>=0.8.0
```
