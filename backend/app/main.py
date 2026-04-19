from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.core.database import init_db
from app.api import auth, media, lab, lab_advanced, lab_gemini


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    print("=" * 60)
    print(f"  {settings.APP_NAME} backend is up")
    print(f"  API:  http://127.0.0.1:8000{settings.API_V1_PREFIX}")
    print(f"  Docs: http://127.0.0.1:8000/docs")
    print(f"  Dev email mode: {'ON (console)' if not settings.EMAIL_ENABLED else 'SMTP'}")
    print("=" * 60)
    yield


app = FastAPI(
    title=f"{settings.APP_NAME} API",
    description="Responsible AI media forensics — detection, transformation, audit.",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_origin_regex=settings.CORS_ORIGIN_REGEX or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    if request.url.path.startswith(settings.API_V1_PREFIX):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, private"
        response.headers["Pragma"] = "no-cache"
    return response


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    if settings.DEBUG:
        import traceback
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"detail": f"{type(exc).__name__}: {exc}"})
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.get("/", tags=["meta"])
async def root():
    return {
        "app": settings.APP_NAME,
        "version": "0.1.0",
        "status": "ok",
        "api_prefix": settings.API_V1_PREFIX,
        "docs": "/docs",
    }


@app.get("/health", tags=["meta"])
async def health():
    return {"status": "healthy"}


app.include_router(auth.router, prefix=settings.API_V1_PREFIX)
app.include_router(media.router, prefix=settings.API_V1_PREFIX)
app.include_router(lab.router, prefix=settings.API_V1_PREFIX)
app.include_router(lab_advanced.router, prefix=settings.API_V1_PREFIX)
app.include_router(lab_gemini.router, prefix=settings.API_V1_PREFIX)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
