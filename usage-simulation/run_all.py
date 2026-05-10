"""
run_all.py — Fire all 4 users concurrently through APIM.

Each user's calls use their own APIM subscription key, so:
  • APIM enforces TPM quotas per user (throttles anyone who exceeds their limit)
  • Azure Monitor records tokens per deployment (visible in the dashboard)

Wait for APIM to finish switching to External VNet before running
(check with: az rest --method get --url https://management.azure.com/subscriptions/87ec57f9-f0ea-43d1-822b-8c9a98d889ca/resourceGroups/foundry-observability-rg/providers/Microsoft.ApiManagement/service/observabilty-foundry?api-version=2022-08-01 --query properties.provisioningState -o tsv)

Usage:
    python run_all.py                           # default: gpt-5.4-mini-01, 1 round
    python run_all.py --deployment Kimi-K2.6-1
    python run_all.py --rounds 3                # 3x prompts per user
    python run_all.py --delay 2                 # 2s between each user's calls
"""

import argparse
import os
import threading
from dotenv import load_dotenv
from common import DEPLOYMENT_GPT, DEPLOYMENT_KIMI, run_scenario

load_dotenv()

USERS = [
    {
        "name":    "Peter Parker",
        "key_env": "PETER_PARKER_KEY",
        "system":  "You are a helpful mentor for a curious student. Keep answers concise.",
        "prompts": [
            "Can you explain how REST APIs work in simple terms?",
            "What is Docker and why do developers use it?",
            "Give me a beginner Python project idea that uses an API.",
        ],
    },
    {
        "name":    "Tonny Stark",
        "key_env": "TONNY_STARK_KEY",
        "system":  "You are an expert assistant for a senior cloud architect. Be technically precise.",
        "prompts": [
            "How should I design a multi-tenant APIM gateway with per-customer TPM quotas for Azure AI Foundry?",
            "Compare observability strategies for LLM workloads: Azure Monitor vs OpenTelemetry.",
            "What are the security implications of APIM subscription keys vs managed identities for AI model access?",
        ],
    },
    {
        "name":    "Son Goku",
        "key_env": "SON_GOKU_KEY",
        "system":  "You are an energetic performance coach. Frame answers as training and power levels.",
        "prompts": [
            "How do I make my Python code run as fast as possible?",
            "What is the strongest architecture for serving thousands of AI requests per second?",
            "How can I power up my app to handle sudden traffic spikes without breaking?",
        ],
    },
    {
        "name":    "Monkey D. Luffy",
        "key_env": "MONKEY_D_LUFFY_KEY",
        "system":  "You are an adventurous guide. Frame answers as quests and treasures to discover.",
        "prompts": [
            "What is the adventure path to becoming a cloud engineer?",
            "What are the most exciting new AI features in Azure I should explore?",
            "How do I navigate a complex distributed system to find hidden problems?",
        ],
    },
]


def _run(user: dict, deployment: str, rounds: int, delay: float) -> None:
    key = os.environ[user["key_env"]]
    run_scenario(user["name"], key, deployment, user["system"],
                 user["prompts"] * rounds, delay)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run all user simulations concurrently through APIM")
    parser.add_argument("--deployment", default=DEPLOYMENT_GPT,
                        choices=[DEPLOYMENT_GPT, DEPLOYMENT_KIMI])
    parser.add_argument("--rounds", type=int, default=1,
                        help="Repeat each user's prompt list N times")
    parser.add_argument("--delay", type=float, default=1.5,
                        help="Seconds between each user's consecutive calls")
    args = parser.parse_args()

    print(f"Launching {len(USERS)} users → {args.deployment} via APIM (rounds={args.rounds})")
    threads = [
        threading.Thread(target=_run, args=(u, args.deployment, args.rounds, args.delay), daemon=True)
        for u in USERS
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    print("\n✓ All users finished. Refresh the dashboard (1D / Hourly) to see usage.")


if __name__ == "__main__":
    main()
