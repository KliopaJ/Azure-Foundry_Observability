from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path
from dotenv import load_dotenv

# Load .env from project root (one level above backend/)
load_dotenv(Path(__file__).parent.parent / ".env")

from routers import config, subscriptions, metrics, deployments, policy, cost_limits, quotas, pricing

app = FastAPI(title="Foundry Observability", docs_url="/api/docs")
app.include_router(config.router,        prefix="/api")
app.include_router(subscriptions.router, prefix="/api")
app.include_router(metrics.router,       prefix="/api")
app.include_router(deployments.router,   prefix="/api")
app.include_router(policy.router,        prefix="/api")
app.include_router(cost_limits.router,   prefix="/api")
app.include_router(quotas.router,        prefix="/api")
app.include_router(pricing.router,       prefix="/api")

_static = Path(__file__).parent / "static"
if _static.exists():
    app.mount("/assets", StaticFiles(directory=str(_static / "assets")), name="assets")

    @app.get("/", include_in_schema=False)
    async def spa_root():
        return FileResponse(str(_static / "index.html"))

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str):
        # Serve static files (images, fonts, etc.) if they exist on disk
        file = _static / full_path
        if file.is_file() and ".." not in full_path:
            return FileResponse(str(file))
        return FileResponse(str(_static / "index.html"))
