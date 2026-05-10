"""
peter_parker.py — Usage simulation for Peter Parker (superheroes group).

Calls go through APIM using Peter's subscription key.
APIM enforces his TPM quota; usage appears in the observability dashboard.

Run:
    python peter_parker.py
    python peter_parker.py --deployment Kimi-K2.6-1
    python peter_parker.py --rounds 3
"""

import argparse
import os
from dotenv import load_dotenv
from common import DEPLOYMENT_GPT, DEPLOYMENT_KIMI, run_scenario

load_dotenv()

USER_NAME = "Peter Parker"
SUBSCRIPTION_KEY = os.environ.get("PETER_PARKER_KEY", "")

SYSTEM_PROMPT = (
    "You are a helpful mentor for a curious college student who loves technology, "
    "science, and problem-solving. Keep answers concise and encouraging."
)

PROMPTS = [
    "Can you explain how REST APIs work in simple terms?",
    "What's the difference between machine learning and traditional programming?",
    "How does HTTPS keep my data safe when I browse the web?",
    "What is Docker and why do developers use it?",
    "Give me a beginner project idea that uses Python and an API.",
]


def main() -> None:
    if not SUBSCRIPTION_KEY:
        print("ERROR: Environment variable PETER_PARKER_KEY is not set.")
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
