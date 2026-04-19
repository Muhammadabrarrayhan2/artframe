from pydantic import BaseModel
from datetime import datetime
from typing import Any


class MediaOut(BaseModel):
    id: int
    filename: str
    original_name: str
    media_type: str
    mime_type: str
    file_size: int
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


class AnalysisOut(BaseModel):
    id: int
    media_id: int
    verdict: str
    ai_probability: float
    confidence: float
    signals: dict[str, Any]
    reasons: str
    created_at: datetime

    class Config:
        from_attributes = True


class MediaWithAnalysisOut(BaseModel):
    media: MediaOut
    analysis: AnalysisOut | None = None


class StatsOut(BaseModel):
    total_uploads: int
    total_analyses: int
    likely_ai: int
    likely_real: int
    inconclusive: int
