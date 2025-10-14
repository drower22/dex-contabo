import os
from fastapi import FastAPI, Request, Depends, HTTPException
from fastapi.responses import JSONResponse
from .api.routes import router as api_router

app = FastAPI(title="Dex SQL Agent", version="0.1.0")


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    # Only protect /v1/* endpoints
    if request.url.path.startswith("/v1/"):
        expected_key = os.getenv("SQLAGENT_API_KEY")
        provided_key = request.headers.get("x-api-key")
        if not expected_key or provided_key != expected_key:
            return JSONResponse(status_code=401, content={"error": "unauthorized"})
        # Tenant header required
        account_id = request.headers.get("x-account-id")
        if not account_id:
            return JSONResponse(status_code=400, content={"error": "missing x-account-id"})
    return await call_next(request)


app.include_router(api_router)
