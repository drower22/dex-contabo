from fastapi import APIRouter

router = APIRouter(tags=["Status"])


@router.get("/health", summary="Healthcheck")
def health():
    return {"ok": True}
