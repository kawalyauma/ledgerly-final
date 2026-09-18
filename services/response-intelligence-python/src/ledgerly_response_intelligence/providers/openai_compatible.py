from __future__ import annotations

from urllib.parse import urljoin

import httpx

from .base import ProviderResponse


class OpenAICompatibleProvider:
    name = "openai-compatible"

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        timeout_seconds: float,
    ) -> None:
        self.base_url = base_url.rstrip("/") + "/"
        self.api_key = api_key
        self.model = model
        self.timeout_seconds = timeout_seconds

    async def generate(self, *, system: str, prompt: str, max_tokens: int = 3000) -> ProviderResponse:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            "max_tokens": max_tokens,
            "temperature": 0.55,
        }
        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            response = await client.post(urljoin(self.base_url, "chat/completions"), headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()
        text = str(data.get("choices", [{}])[0].get("message", {}).get("content", "")).strip()
        return ProviderResponse(
            text=text,
            provider=self.name,
            model=self.model,
            usage=dict(data.get("usage") or {}),
            response_id=str(data.get("id") or ""),
        )
