"""
tonny_stark.py — Usage simulation for Tonny Stark (superheroes group).

Calls go through APIM using Tonny's subscription key.
APIM enforces his TPM quota; usage appears in the observability dashboard.

Run:
    python tonny_stark.py
    python tonny_stark.py --deployment Kimi-K2.6-1
    python tonny_stark.py --rounds 3
"""

import argparse
import os
from dotenv import load_dotenv
from common import DEPLOYMENT_GPT, DEPLOYMENT_KIMI, run_scenario

load_dotenv()

USER_NAME = "Tonny Stark"
SUBSCRIPTION_KEY = os.environ.get("TONNY_STARK_KEY", "")

SYSTEM_PROMPT = (
    "You are an expert AI assistant for a senior cloud architect and engineer. "
    "Provide technically deep, precise answers. Skip basic explanations."
)

PROMPTS = [
    "How should I design a multi-tenant APIM gateway that enforces per-customer token-per-minute quotas for Azure AI Foundry?",
    "Compare the observability strategies for LLM workloads: Azure Monitor vs Prometheus+Grafana vs OpenTelemetry.",
    "What are the security implications of using managed identities vs APIM subscription keys for AI model access?",
    "Design a circuit breaker pattern for an LLM gateway that gracefully degrades when the model endpoint is throttled.",
    "What are the trade-offs between synchronous and asynchronous API patterns in high-throughput AI inference pipelines?",
]


def main() -> None:
    if not SUBSCRIPTION_KEY:
        print("ERROR: Environment variable TONNY_STARK_KEY is not set.")
        raise SystemExit(1)

    parser = argparse.ArgumentParser(description=f"Usage simulation – {USER_NAME}")
    parser.add_argument("--deployment", default=DEPLOYMENT_GPT,
                        choices=[DEPLOYMENT_GPT, DEPLOYMENT_KIMI])
    parser.add_argument("--rounds", type=int, default=1)
    parser.add_argument("--delay", type=float, default=1.5)
    args = parser.parse_args()

    run_scenario(USER_NAME, SUBSCRIPTION_KEY, args.deployment, SYSTEM_PROMPT,
                 PROMPTS * args.rounds, args.delay)


if __name__ == "__main__":
    main()
