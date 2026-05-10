from fastapi import APIRouter, Header, HTTPException
from typing import Optional
import httpx

router = APIRouter()
ARM      = "https://management.azure.com"
CS_VER   = "2023-05-01"
PROJ_VER = "2025-04-01-preview"


def _hdrs(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _extract(auth: Optional[str]) -> str:
    if not auth or not auth.startswith("Bearer "):
        raise HTTPException(401, "Missing Bearer token")
    return auth[7:]


def _raise(r: httpx.Response):
    if not r.is_success:
        raise HTTPException(r.status_code, r.text[:400])


@router.get("/subscriptions")
async def list_subscriptions(authorization: Optional[str] = Header(None)):
    token = _extract(authorization)
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(
            f"{ARM}/subscriptions?api-version=2022-12-01",
            headers=_hdrs(token),
        )
        _raise(r)
        return [
            {"id": s["subscriptionId"], "name": s["displayName"]}
            for s in r.json().get("value", [])
            if s.get("state") == "Enabled"
        ]


@router.get("/foundry-resources")
async def list_foundry_resources(sub_id: str, authorization: Optional[str] = Header(None)):
    token = _extract(authorization)

    if sub_id == "__all__":
        # Use Azure Resource Graph for instant cross-tenant query
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.post(
                f"{ARM}/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01",
                headers=_hdrs(token),
                json={
                    "query": (
                        "resources "
                        "| where type == 'microsoft.cognitiveservices/accounts' "
                        "| where kind in ('AIServices', 'OpenAI', 'CognitiveServices') "
                        "| project name, rg=resourceGroup, kind, subId=subscriptionId"
                    ),
                    "options": {"$top": 1000},
                },
            )
            _raise(r)
            items = r.json().get("data", [])

        # Fetch subscription names for display
        async with httpx.AsyncClient(timeout=15) as c:
            sr = await c.get(
                f"{ARM}/subscriptions?api-version=2022-12-01",
                headers=_hdrs(token),
            )
        sub_names = {}
        if sr.is_success:
            sub_names = {
                s["subscriptionId"]: s["displayName"]
                for s in sr.json().get("value", [])
            }

        return [
            {
                "name": row["name"],
                "rg": row["rg"],
                "subId": row["subId"],
                "subName": sub_names.get(row["subId"], row["subId"]),
            }
            for row in items
        ]

    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(
            f"{ARM}/subscriptions/{sub_id}/providers/Microsoft.CognitiveServices"
            f"/accounts?api-version={CS_VER}",
            headers=_hdrs(token),
        )
        _raise(r)
        return [
            {
                "name": a["name"],
                "rg": a["id"].split("/resourceGroups/")[1].split("/")[0],
                "subId": sub_id,
            }
            for a in r.json().get("value", [])
            if a.get("kind") in ("AIServices", "OpenAI", "CognitiveServices")
        ]


@router.get("/projects")
async def list_projects(
    sub_id: str, rg: str, foundry: str,
    authorization: Optional[str] = Header(None),
):
    token = _extract(authorization)
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(
            f"{ARM}/subscriptions/{sub_id}/resourceGroups/{rg}"
            f"/providers/Microsoft.CognitiveServices/accounts/{foundry}"
            f"/projects?api-version={PROJ_VER}",
            headers=_hdrs(token),
        )
        if r.status_code in (400, 404):
            return []
        _raise(r)
        return [p["name"].split("/", 1)[-1] for p in r.json().get("value", [])]
