"""
common.py — Shared helpers for usage-simulation scripts.

ALL calls go through the APIM gateway so rate limits / TPM quotas are enforced
per-user subscription key. Usage appears in both:
  • APIM analytics  (per subscription key = per user)
  • Azure Monitor   (per ModelDeploymentName on the Foundry resource)

The APIM service is being switched from Internal → External VNet.
Once that completes (~30-45 min after first deploy), the gateway URL below
will be publicly reachable and these scripts work from any machine.

Per-user APIM subscription keys (already created):
  peter-parker    → PETER_PARKER_KEY
  tonny-stark     → TONNY_STARK_KEY
  son-goku        → SON_GOKU_KEY
  monkey-d-luffy  → MONKEY_D_LUFFY_KEY
"""

import os
import time
from openai import AzureOpenAI
from dotenv import load_dotenv

load_dotenv()

APIM_GATEWAY_URL = os.environ.get(
    "APIM_GATEWAY_URL",
    "https://foundry-observability2-apim.azure-api.net",
)
API_VERSION     = os.environ.get("OPENAI_API_VERSION", "2025-01-01-preview")
DEPLOYMENT_GPT  = os.environ.get("DEPLOYMENT_GPT",  "gpt-5.4-mini")
DEPLOYMENT_KIMI = os.environ.get("DEPLOYMENT_KIMI", "Kimi-K2.5")


def build_client(subscription_key: str) -> AzureOpenAI:
    """
    Return an AzureOpenAI client that routes through APIM.
    The subscription key identifies the user — APIM enforces TPM quotas per key.
    """
    return AzureOpenAI(
        azure_endpoint=APIM_GATEWAY_URL,
        api_key=subscription_key,
        api_version=API_VERSION,
        default_headers={
            "api-key": subscription_key,
            "Ocp-Apim-Subscription-Key": subscription_key,
        },
        max_retries=0,
        timeout=60,
    )


def chat(client: AzureOpenAI, deployment: str, system: str, prompt: str) -> str:
    resp = client.chat.completions.create(
        model=deployment,
        messages=[
            {"role": "system", "content": system},
            {"role": "user",   "content": prompt},
        ],
        max_completion_tokens=2048,
        temperature=0.8,
    )
    return resp.choices[0].message.content


def run_scenario(
    user_name: str,
    subscription_key: str,
    deployment: str,
    system_prompt: str,
    prompts: list[str],
    delay: float = 1.5,
) -> None:
    client = build_client(subscription_key)
    print(f"\n{'='*60}")
    print(f"  User       : {user_name}")
    print(f"  Deployment : {deployment}")
    print(f"  Gateway    : {APIM_GATEWAY_URL}")
    print(f"  APIM key   : ...{subscription_key[-6:]}")
    print(f"{'='*60}")

    for i, prompt in enumerate(prompts, 1):
        print(f"\n[{i}/{len(prompts)}] {prompt[:80]}{'...' if len(prompt) > 80 else ''}")
        try:
            reply = chat(client, deployment, system_prompt, prompt)
            print(f"→ {reply[:300]}{'...' if len(reply) > 300 else ''}")
        except Exception as exc:
            msg = str(exc)
            if "429" in msg:
                print(f"⚠ QUOTA LIMIT (429) — APIM throttling enforced")
            else:
                print(f"ERROR: {exc}")
        if i < len(prompts):
            time.sleep(delay)

    print(f"\n✓ {user_name} — {len(prompts)} call(s) complete")
