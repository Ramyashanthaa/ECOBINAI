import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

from backend.api.routes import classify as classify_router_module
from backend.api.routes import stats as stats_router
from backend.api.schemas import HealthResponse
from backend.config import settings
from backend.database.models import create_tables
from backend.hardware.bin_controller import get_controller
from backend.hardware.simulator import capture_loop

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    create_tables()
    capture_loop()          # store running loop for thread-safe WebSocket broadcasts
    controller = get_controller()
    classify_router_module.set_controller(controller)
    logger.info(
        f"EcoBinAI started | backend={settings.gemma_backend} "
        f"model={settings.gemma_model} hardware={settings.hardware_mode}"
    )
    yield
    # Shutdown
    if hasattr(controller, "cleanup"):
        controller.cleanup()
    logger.info("EcoBinAI stopped")


app = FastAPI(
    title="EcoBinAI",
    description=(
        "Smart waste classification powered by Gemma 4 multimodal vision. "
        "Detects waste type and opens the correct bin lid automatically."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(classify_router_module.router, prefix="/api")
app.include_router(stats_router.router, prefix="/api")


@app.get("/api/health", response_model=HealthResponse, tags=["system"])
def health():
    return HealthResponse(
        status="ok",
        backend=settings.gemma_backend,
        model=settings.gemma_model,
        hardware_mode=settings.hardware_mode,
    )


# Serve React frontend from /frontend/dist (after npm run build)
_frontend_dist = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist")
if os.path.isdir(_frontend_dist):
    app.mount("/assets", StaticFiles(directory=os.path.join(_frontend_dist, "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_spa(full_path: str):
        index = os.path.join(_frontend_dist, "index.html")
        return FileResponse(index)
