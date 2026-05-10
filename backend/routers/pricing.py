"""Scrape official Azure pricing pages and return structured model pricing."""

from __future__ import annotations

import json
import re
import logging
from fastapi import APIRouter, HTTPException

import httpx

router = APIRouter()
log = logging.getLogger(__name__)

# ── Pages to scrape ──────────────────────────────────────────────────────────
_PAGES = {
    "openai":    "https://azure.microsoft.com/en-us/pricing/details/cognitive-services/openai-service/",
    "deepseek":  "https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/deepseek/",
    "kimi":      "https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/kimi/",
    "llama":     "https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/llama/",
    "microsoft": "https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/microsoft/",
}

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept": "text/html,application/xhtml+xml",
}

# Reference region for "Global Standard" pricing
_REF_REGION = "us-east"

# ── Helpers ──────────────────────────────────────────────────────────────────

# Extract the first price from a data-amount JSON blob for the reference region
_DATA_AMOUNT = re.compile(r"data-amount='(\{.*?\})'", re.DOTALL)


def _extract_price(span_html: str) -> float | None:
    """Pull the reference-region price from a <span class='price-data' data-amount='...'> element."""
    m = _DATA_AMOUNT.search(span_html)
    if not m:
        return None
    try:
        blob = json.loads(m.group(1))
    except json.JSONDecodeError:
        return None
    regional = blob.get("regional", {})
    val = regional.get(_REF_REGION)
    if val is not None:
        return round(float(val), 6)
    # fallback: first available region
    for v in regional.values():
        return round(float(v), 6)
    return None


# Split HTML into <tr>...</tr> blocks
_TR_RE = re.compile(r"<tr[^>]*>(.*?)</tr>", re.DOTALL | re.IGNORECASE)
_TD_RE = re.compile(r"<td[^>]*>(.*?)</td>", re.DOTALL | re.IGNORECASE)
_TAG_RE = re.compile(r"<[^>]+>")

# Canonicalise model names
_STRIP_DATE = re.compile(r"-\d{4}-\d{2}-\d{2}$")
_STRIP_MMDD = re.compile(r"-\d{4}$")  # e.g. -0718
_STRIP_CHAT = re.compile(r"-chat$", re.I)


def _canon(raw: str) -> str:
    """Normalise a model name like 'GPT-4.1-2025-04-14 Global' → 'gpt-4.1'."""
    name = raw.strip()
    # Remove tier qualifiers
    for suffix in (" Global", " DataZone", " Datazone", " Regional"):
        if name.endswith(suffix):
            name = name[: -len(suffix)]
    name = name.strip().lower()
    if not name or name == "global":
        return ""
    name = _STRIP_DATE.sub("", name)
    name = _STRIP_MMDD.sub("", name)
    name = _STRIP_CHAT.sub("", name)
    # Remove "thinking", "sp" qualifiers for Kimi etc
    name = re.sub(r"\s+(thinking|sp)\b", "", name)
    name = name.replace(" ", "-")
    return name


# ── OpenAI page parser ───────────────────────────────────────────────────────
# Each <tr> row on the OpenAI page:
#   <td>GPT-4.1-2025-04-14 Global</td>
#   <td>
#     Input: <span class='price-data' data-amount='{"regional":{...}}'> ... </span><br/>
#     Cached Input: <span ...> ... </span><br/>
#     Output: <span ...> ... </span>
#   </td>
#   <td>...</td>  (possibly more columns for Data Zone / Batch)

def _parse_openai(html: str) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for tr_m in _TR_RE.finditer(html):
        tr = tr_m.group(1)
        tds = _TD_RE.findall(tr)
        if len(tds) < 2:
            continue
        # First <td> is the model name
        model_raw = _TAG_RE.sub("", tds[0]).strip()
        if "Global" not in model_raw:
            continue
        key = _canon(model_raw)
        if not key or key in out:
            continue

        # Second <td> has "Input: <span...>, Cached Input: <span...>, Output: <span...>"
        price_cell = tds[1]

        # Split by data-amount spans and pair each with its label
        # Strategy: find each data-amount occurrence, get the plain text label
        # that immediately precedes it.
        spans = list(_DATA_AMOUNT.finditer(price_cell))
        if not spans:
            continue

        prices: dict[str, float] = {}
        for i, span_m in enumerate(spans):
            val = _extract_price(span_m.group(0))
            if val is None:
                continue
            # Get text between previous span end (or cell start) and this span
            start = spans[i - 1].end() if i > 0 else 0
            between = _TAG_RE.sub("", price_cell[start : span_m.start()]).strip().lower()
            if "cached input" in between:
                prices["cachedInput"] = val
            elif "output" in between:
                prices["output"] = val
            elif "input" in between:
                prices["input"] = val

        if "input" in prices and "output" in prices:
            out[key] = {
                "input": prices["input"],
                "cachedInput": prices.get("cachedInput", 0),
                "output": prices["output"],
            }
    return out


# ── Foundry Models page parser (DeepSeek / Kimi / Llama / Microsoft) ─────────
# Format varies:
#   DeepSeek: <td>Model Global</td> <td>input</td> <td>output</td>
#   Phi:      <td>Model</td> <td>context</td> <td>input</td> <td>output</td>
# Strategy: first TD is model name; find the first two TDs with price spans.

_SKIP_TIERS = {"DataZone", "Datazone", "Regional"}


def _parse_foundry(html: str) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for tr_m in _TR_RE.finditer(html):
        tr = tr_m.group(1)
        tds = _TD_RE.findall(tr)
        if len(tds) < 3:
            continue
        model_raw = _TAG_RE.sub("", tds[0]).strip()
        if not model_raw:
            continue
        # Skip DataZone / Regional rows when Global rows exist
        if any(model_raw.endswith(f" {t}") for t in _SKIP_TIERS):
            continue
        key = _canon(model_raw)
        if not key or key in out:
            continue

        # Find the first two TDs (after tds[0]) that contain data-amount spans
        price_tds = [td for td in tds[1:] if "data-amount" in td]
        if len(price_tds) < 2:
            continue

        inp = _extract_price(price_tds[0])
        outp = _extract_price(price_tds[1])
        if inp is not None and outp is not None:
            out[key] = {"input": inp, "cachedInput": 0, "output": outp}
    return out


@router.get("/pricing")
async def get_pricing():
    """Scrape all pricing pages and return a unified pricing dict."""
    result: dict[str, dict] = {}
    errors: list[str] = []

    async with httpx.AsyncClient(timeout=30, follow_redirects=True, headers=_HEADERS) as client:
        for provider, url in _PAGES.items():
            try:
                resp = await client.get(url)
                resp.raise_for_status()
                html = resp.text
                if provider == "openai":
                    parsed = _parse_openai(html)
                else:
                    parsed = _parse_foundry(html)
                result.update(parsed)
                log.info("Parsed %d models from %s", len(parsed), provider)
            except Exception as exc:
                log.warning("Failed to fetch %s pricing: %s", provider, exc)
                errors.append(f"{provider}: {exc}")

    if not result:
        raise HTTPException(status_code=502, detail=f"Could not fetch any pricing data: {'; '.join(errors)}")

    return {"pricing": result, "errors": errors}
