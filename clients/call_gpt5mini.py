"""
call_gpt5mini.py — Send a prompt directly to gpt-5.4-mini-01 in Azure AI Foundry.

The request goes directly to the Foundry endpoint (bypasses APIM).
Auth uses the Foundry resource API key from .env.

Usage:
    python call_gpt5mini.py
    python call_gpt5mini.py --prompt "Summarise the concept of retrieval-augmented generation"
"""

import argparse
import os

from dotenv import load_dotenv
from openai import AzureOpenAI

load_dotenv()

AZURE_OPENAI_ENDPOINT = os.environ["AZURE_OPENAI_ENDPOINT"]
AZURE_OPENAI_API_KEY  = os.environ["AZURE_OPENAI_API_KEY"]
OPENAI_API_VERSION    = os.environ.get("OPENAI_API_VERSION", "2025-01-01-preview")
DEPLOYMENT            = os.environ.get("DEPLOYMENT_GPT5_MINI", "gpt-5.4-mini-01")


def build_client() -> AzureOpenAI:
    return AzureOpenAI(
        azure_endpoint=AZURE_OPENAI_ENDPOINT,
        api_key=AZURE_OPENAI_API_KEY,
        api_version=OPENAI_API_VERSION,
    )


def chat(prompt: str) -> str:
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
        max_completion_tokens=512,
        temperature=0.7,
    )

    return response.choices[0].message.content


def main() -> None:
    parser = argparse.ArgumentParser(description=f"Chat directly with {DEPLOYMENT}")
    parser.add_argument(
        "--prompt",
        default="What is gpt-5.4-mini and what are its strengths?",
        help="Prompt to send",
    )
    args = parser.parse_args()

    print(f"Endpoint   : {AZURE_OPENAI_ENDPOINT}")
    print(f"Deployment : {DEPLOYMENT}")
    print(f"Prompt     : {args.prompt}")
    print("-" * 60)

    reply = chat(args.prompt)
    print(reply)


if __name__ == "__main__":
    main()
