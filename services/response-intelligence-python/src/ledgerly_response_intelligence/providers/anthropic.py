from __future__ import annotations

import httpx

from .base import ProviderResponse


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, *, api_key: str, model: str, timeout_seconds: float, base_url: str = "") -> None:
        self.api_key = api_key
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.base_url = (base_url or "https://api.anthropic.com/v1").rstrip("/")

    async def generate(self, *, system: str, prompt: str, max_tokens: int = 3000) -> ProviderResponse:
        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.model,
            "system": system,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": max_tokens,
            "temperature": 0.55,
        }
        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            response = await client.post(f"{self.base_url}/messages", headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()
        text = "\n".join(
            str(part.get("text", ""))
            for part in data.get("content", [])
            if isinstance(part, dict) and part.get("type") == "text"
        ).strip()
        return ProviderResponse(
            text=text,
            provider=self.name,
            model=self.model,
            usage=dict(data.get("usage") or {}),
            response_id=str(data.get("id") or ""),
        )
