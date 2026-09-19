from __future__ import annotations

from urllib.parse import urlparse

import httpx

from ..config import Settings
from .base import ToolCapability, ToolRequest, ToolResult
from .registry import ToolRegistry


def _allowed_domains(settings:Settings)->list[str]:
    return [item.strip().lower() for item in settings.web_search_domain_allowlist.split(",") if item.strip()]


def _domain_allowed(url:str,allowlist:list[str])->bool:
    if not allowlist:
        return True
    try:
        host=(urlparse(url).hostname or "").lower()
    except ValueError:
        return False
    return any(host==domain or host.endswith("."+domain) for domain in allowlist)


async def _brave(settings:Settings,request:ToolRequest)->ToolResult:
    base=(settings.web_search_base_url or "https://api.search.brave.com/res/v1/web/search").rstrip("/")
    limit=max(1,min(int(request.arguments.get("limit") or settings.web_search_max_results),20))
    headers={"Accept":"application/json","X-Subscription-Token":settings.web_search_api_key}
    params={"q":request.query,"count":limit,"text_decorations":"false","search_lang":"en"}
    async with httpx.AsyncClient(timeout=settings.web_search_timeout_seconds) as client:
        response=await client.get(base,headers=headers,params=params)
    response.raise_for_status()
    payload=response.json()
    raw=((payload.get("web") or {}).get("results") or []) if isinstance(payload,dict) else []
    allowlist=_allowed_domains(settings)
    results=[]
    sources=[]
    for item in raw:
        if not isinstance(item,dict):
            continue
        url=str(item.get("url") or "")
        if not url or not _domain_allowed(url,allowlist):
            continue
        result={
            "title":str(item.get("title") or ""),
            "url":url,
            "snippet":str(item.get("description") or ""),
            "age":str(item.get("age") or ""),
            "provider":"brave",
        }
        results.append(result)
        sources.append({"url":url,"title":result["title"],"sourceType":"web","provider":"brave"})
        if len(results)>=limit:
            break
    return ToolResult(name="web.search",ok=True,data={"query":request.query,"results":results},sources=sources)


async def _tavily(settings:Settings,request:ToolRequest)->ToolResult:
    base=(settings.web_search_base_url or "https://api.tavily.com/search").rstrip("/")
    limit=max(1,min(int(request.arguments.get("limit") or settings.web_search_max_results),20))
    allowlist=_allowed_domains(settings)
    body={
        "api_key":settings.web_search_api_key,
        "query":request.query,
        "max_results":limit,
        "search_depth":"advanced",
        "include_answer":False,
        "include_raw_content":False,
    }
    if allowlist:
        body["include_domains"]=allowlist
    async with httpx.AsyncClient(timeout=settings.web_search_timeout_seconds) as client:
        response=await client.post(base,json=body)
    response.raise_for_status()
    payload=response.json()
    raw=payload.get("results") or [] if isinstance(payload,dict) else []
    results=[]
    sources=[]
    for item in raw:
        if not isinstance(item,dict):
            continue
        url=str(item.get("url") or "")
        if not url or not _domain_allowed(url,allowlist):
            continue
        result={
            "title":str(item.get("title") or ""),
            "url":url,
            "snippet":str(item.get("content") or ""),
            "score":float(item.get("score") or 0),
            "provider":"tavily",
        }
        results.append(result)
        sources.append({"url":url,"title":result["title"],"sourceType":"web","provider":"tavily"})
        if len(results)>=limit:
            break
    return ToolResult(name="web.search",ok=True,data={"query":request.query,"results":results},sources=sources)


def build_external_tool_registry(settings:Settings)->ToolRegistry:
    registry=ToolRegistry()
    enabled=bool(
        settings.allow_external_tools
        and settings.allow_web_search
        and settings.web_search_provider!="none"
        and settings.web_search_api_key.strip()
    )
    capability=ToolCapability(
        name="web.search",
        description="Search live public web sources for current or external reference information.",
        categories=["web","external-knowledge","research"],
        external=True,
        enabled=enabled,
    )
    async def handler(request:ToolRequest)->ToolResult:
        if settings.web_search_provider=="brave":
            return await _brave(settings,request)
        if settings.web_search_provider=="tavily":
            return await _tavily(settings,request)
        return ToolResult(name=request.name,ok=False,error="No web search provider is configured.")
    registry.register(capability,handler)
    return registry
