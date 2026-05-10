from fastapi import APIRouter, Header
from typing import Optional
import httpx
from routers.subscriptions import _extract, _raise

router = APIRouter()
ARM    = "https://management.azure.com"
CS_VER = "2023-05-01"


@router.get("/deployments")
async def list_deployments(
    sub_id: str, rg: str, foundry: str,
    authorization: Optional[str] = Header(None),
):
    token = _extract(authorization)
    items = []
    url = (
        f"{ARM}/subscriptions/{sub_id}/resourceGroups/{rg}"
        f"/providers/Microsoft.CognitiveServices/accounts/{foundry}"
        f"/deployments?api-version={CS_VER}"
    )
    async with httpx.AsyncClient(timeout=30) as c:
        while url:
            r = await c.get(url, headers={"Authorization": f"Bearer {token}"})
            _raise(r)
            body = r.json()
            items.extend(body.get("value", []))
            url = body.get("nextLink")
    return sorted(
        [
            {
                "name": d["name"],
                "model": d.get("properties", {}).get("model", {}).get("name", ""),
                "modelFormat": d.get("properties", {}).get("model", {}).get("format", ""),
            }
            for d in items
        ],
        key=lambda x: x["name"],
    )
