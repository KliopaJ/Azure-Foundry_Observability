from fastapi import APIRouter, Body
import json
from pathlib import Path

router = APIRouter()

_FILE = Path(__file__).parent.parent / "cost_limits.json"


def _load() -> dict:
    if _FILE.exists():
        try:
            return json.loads(_FILE.read_text())
        except Exception:
            pass
    return {"users": {}, "groups": {}, "groupMonthlyTokens": {}}


@router.get("/cost-limits")
def get_cost_limits():
    return _load()


@router.put("/cost-limits")
def put_cost_limits(body: dict = Body(...)):
    data = {
        "users":  {k: float(v) for k, v in body.get("users",  {}).items() if v is not None},
        "groups": {k: float(v) for k, v in body.get("groups", {}).items() if v is not None},
        "groupMonthlyTokens": {k: int(v) for k, v in body.get("groupMonthlyTokens", {}).items() if v is not None},
    }
    if body.get("projectBudget") is not None:
        data["projectBudget"] = float(body["projectBudget"])
    if body.get("projectMonthlyTokens") is not None:
        data["projectMonthlyTokens"] = int(body["projectMonthlyTokens"])
    _FILE.write_text(json.dumps(data, indent=2))
    return {"ok": True}
