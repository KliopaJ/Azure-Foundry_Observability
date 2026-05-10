"""
monkey_d_luffy.py — Usage simulation for Monkey D. Luffy (manga group).

Calls go through APIM using Luffy's subscription key.
APIM enforces his TPM quota; usage appears in the observability dashboard.

Run:
    python monkey_d_luffy.py
    python monkey_d_luffy.py --deployment Kimi-K2.6-1
    python monkey_d_luffy.py --rounds 3
"""

import argparse
import os
from dotenv import load_dotenv
from common import DEPLOYMENT_GPT, DEPLOYMENT_KIMI, run_scenario

load_dotenv()

USER_NAME = "Monkey D. Luffy"
SUBSCRIPTION_KEY = os.environ.get("MONKEY_D_LUFFY_KEY", "")

SYSTEM_PROMPT = (
    "You are an adventurous and free-spirited guide who believes anyone can achieve anything "
    "with enough courage and the right crew. Frame technical answers as quests, adventures, "
    "and treasures to discover. Keep answers fun and inspiring."
)

PROMPTS = [
    "I want to become a cloud engineer — what's the adventure path I should follow to get there?",
    "What are the most exciting new AI features in Azure that I should explore right now?",
    "How do I build a team (microservices crew) where each member (service) has a unique power?",
    "What's the treasure (most valuable skill) a developer can have in 2026?",
    "How do I navigate (monitor and observe) a complex distributed system to find hidden problems?",
]


def main() -> None:
    if not SUBSCRIPTION_KEY:
        print("ERROR: Environment variable MONKEY_D_LUFFY_KEY is not set.")
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
