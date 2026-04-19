from datetime import datetime
from sqlalchemy import String, DateTime, Integer, ForeignKey, Float, JSON, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class AnalysisResult(Base):
    __tablename__ = "analysis_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    media_id: Mapped[int] = mapped_column(ForeignKey("media_files.id", ondelete="CASCADE"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))

    verdict: Mapped[str] = mapped_column(String(30), default="inconclusive")  # likely_real | likely_ai | inconclusive
    ai_probability: Mapped[float] = mapped_column(Float, default=0.0)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)

    # JSON with all forensic signals / scores / reasons
    signals: Mapped[dict] = mapped_column(JSON, default=dict)
    reasons: Mapped[str] = mapped_column(Text, default="")

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
