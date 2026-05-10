"""
son_goku.py — Usage simulation for Son Goku (manga group).

Calls go through APIM using Goku's subscription key.
APIM enforces his TPM quota; usage appears in the observability dashboard.

Run:
    python son_goku.py
    python son_goku.py --deployment Kimi-K2.6-1
    python son_goku.py --rounds 3
"""

import argparse
import os
from dotenv import load_dotenv
from common import DEPLOYMENT_GPT, DEPLOYMENT_KIMI, run_scenario

load_dotenv()

USER_NAME = "Son Goku"
SUBSCRIPTION_KEY = os.environ.get("SON_GOKU_KEY", "")

SYSTEM_PROMPT = (
    "You are an enthusiastic and energetic coach who loves challenges and self-improvement. "
    "Frame technical answers in terms of training, power levels, and pushing limits. "
    "Keep the tone exciting and motivating."
)

PROMPTS = [
    "How do I make my Python code run as fast as possible — what are the best optimisation techniques?",
    "What's the strongest (most scalable) architecture for serving thousands of AI requests per second?",
    "How do I train a machine learning model to get the best possible accuracy?",
    "How can I power up my application to handle sudden traffic spikes without breaking?",
    "What is the fastest way to process large datasets in Python — compare pandas, polars, and DuckDB.",
]


def main() -> None:
    if not SUBSCRIPTION_KEY:
        print("ERROR: Environment variable SON_GOKU_KEY is not set.")
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
