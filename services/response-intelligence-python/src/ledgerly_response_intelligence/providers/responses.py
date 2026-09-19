from __future__ import annotations

import httpx

from .base import ProviderResponse


def _response_text(payload: dict[str, object]) -> str:
    direct = payload.get("output_text")
    if isinstance(direct, str) and direct.strip():
        return direct.strip()
    chunks: list[str] = []
    output = payload.get("output")
    if isinstance(output, list):
        for item in output:
            if not isinstance(item, dict) or item.get("type") != "message":
                continue
            content = item.get("content")
            if not isinstance(content, list):
                continue
            for part in content:
                if isinstance(part, dict) and part.get("type") == "output_text" and part.get("text"):
                    chunks.append(str(part["text"]))
    return "\n".join(chunks).strip()


class ResponsesProvider:
    name = "responses"

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        timeout_seconds: float,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.timeout_seconds = timeout_seconds

    async def generate(self, *, system: str, prompt: str, max_tokens: int = 3000) -> ProviderResponse:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        payload = {
            "model": self.model,
            "instructions": system,
            "input": prompt,
            "max_output_tokens": max_tokens,
        }
        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            response = await client.post(f"{self.base_url}/responses", headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()
        return ProviderResponse(
            text=_response_text(data),
            provider=self.name,
            model=self.model,
            usage=dict(data.get("usage") or {}),
            response_id=str(data.get("id") or ""),
        )
