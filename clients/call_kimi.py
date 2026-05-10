"""
call_kimi.py — Send a prompt directly to Kimi-K2.6-1 in Azure AI Foundry.

The request goes directly to the Foundry endpoint (bypasses APIM).
Auth uses the Foundry resource API key from .env.

Usage:
    python call_kimi.py
    python call_kimi.py --prompt "Explain the attention mechanism in transformers"
"""

import argparse
import os

from dotenv import load_dotenv
from openai import AzureOpenAI

load_dotenv()

AZURE_OPENAI_ENDPOINT = os.environ["AZURE_OPENAI_ENDPOINT"]
AZURE_OPENAI_API_KEY  = os.environ["AZURE_OPENAI_API_KEY"]
OPENAI_API_VERSION    = os.environ.get("OPENAI_API_VERSION", "2025-01-01-preview")
DEPLOYMENT            = os.environ.get("DEPLOYMENT_KIMI", "Kimi-K2.6-1")


def build_client() -> AzureOpenAI:
    return AzureOpenAI(
        azure_endpoint=AZURE_OPENAI_ENDPOINT,
        api_key=AZURE_OPENAI_API_KEY,
        api_version=OPENAI_API_VERSION,
    )


def chat(prompt: str) -> dict:
    """Returns dict with 'reasoning' and 'content' keys. Kimi is a thinking model."""
    client = build_client()

    response = client.chat.completions.create(
        model=DEPLOYMENT,
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
        max_completion_tokens=2048,  # Kimi uses reasoning tokens internally; needs a larger budget
        temperature=0.7,
    )

    message = response.choices[0].message
    return {
        "reasoning": getattr(message, "reasoning_content", None),
        "content": message.content,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=f"Chat directly with {DEPLOYMENT}")
    parser.add_argument(
        "--prompt",
        default="What is Kimi-K2 and what sets it apart from other large language models?",
        help="Prompt to send",
    )
    args = parser.parse_args()

    print(f"Endpoint   : {AZURE_OPENAI_ENDPOINT}")
    print(f"Deployment : {DEPLOYMENT}")
    print(f"Prompt     : {args.prompt}")
    print("-" * 60)

    result = chat(args.prompt)
    if result["reasoning"]:
        print("[Reasoning]")
        print(result["reasoning"])
        print("-" * 60)
    print("[Response]")
    print(result["content"])


if __name__ == "__main__":
    main()
