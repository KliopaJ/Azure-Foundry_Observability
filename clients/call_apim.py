"""
call_apim.py — Send a prompt through the APIM gateway to any Foundry deployment.

The request goes:
  You → APIM (auth + quota + telemetry) → private endpoint → Foundry model

Usage:
    python call_apim.py
    python call_apim.py --deployment Kimi-K2.6-1 --prompt "Explain observability"
"""

import argparse
import os

from dotenv import load_dotenv
from openai import AzureOpenAI

load_dotenv()

APIM_GATEWAY_URL    = os.environ["APIM_GATEWAY_URL"]
APIM_SUBSCRIPTION_KEY = os.environ["APIM_SUBSCRIPTION_KEY"]
OPENAI_API_VERSION  = os.environ.get("OPENAI_API_VERSION", "2025-01-01-preview")
DEFAULT_DEPLOYMENT  = os.environ.get("DEPLOYMENT_GPT5_MINI", "gpt-5.4-mini-01")


def build_client() -> AzureOpenAI:
    """
    AzureOpenAI client pointed at the APIM gateway.
    The subscription key is injected as the default_headers so every request
    automatically carries Ocp-Apim-Subscription-Key.
    """
    return AzureOpenAI(
        azure_endpoint=APIM_GATEWAY_URL,
        api_key=APIM_SUBSCRIPTION_KEY,        # APIM validates this, not Foundry
        api_version=OPENAI_API_VERSION,
        default_headers={
            "api-key": APIM_SUBSCRIPTION_KEY,
        },
        max_retries=0,
    )


def chat(deployment: str, prompt: str) -> str:
    client = build_client()

    response = client.chat.completions.create(
        model=deployment,
        messages=[
            {
                "role": "system",
                "content": "You are a helpful assistant.",
            },
            {
                "role": "user",
                "content": prompt,
            },
        ],
        max_completion_tokens=512,
        temperature=0.7,
    )

    return response.choices[0].message.content


def main() -> None:
    parser = argparse.ArgumentParser(description="Call Foundry via APIM gateway")
    parser.add_argument(
        "--deployment",
        default=DEFAULT_DEPLOYMENT,
        help=f"Foundry deployment name (default: {DEFAULT_DEPLOYMENT})",
    )
    parser.add_argument(
        "--prompt",
        default="What is Azure API Management and why would you use it in front of AI models?",
        help="Prompt to send",
    )
    args = parser.parse_args()

    print(f"Gateway : {APIM_GATEWAY_URL}")
    print(f"Model   : {args.deployment}")
    print(f"Prompt  : {args.prompt}")
    print("-" * 60)

    reply = chat(args.deployment, args.prompt)
    print(reply)


if __name__ == "__main__":
    main()
