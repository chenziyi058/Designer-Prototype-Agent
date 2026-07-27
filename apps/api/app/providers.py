from __future__ import annotations

import asyncio
import json
from abc import ABC, abstractmethod
from typing import Any

import httpx
from pydantic import BaseModel

from .config import Settings, settings


class ProviderError(RuntimeError):
    pass


class ModelProvider(ABC):
    @abstractmethod
    async def generate_text(self, messages: list[dict[str, str]], **kwargs: Any) -> str: ...

    @abstractmethod
    async def generate_json(
        self, messages: list[dict[str, str]], schema: type[BaseModel], **kwargs: Any
    ) -> dict[str, Any]: ...

    @abstractmethod
    async def call_tools(
        self, messages: list[dict[str, str]], tools: list[dict[str, Any]], **kwargs: Any
    ) -> dict[str, Any]: ...


class DeepSeekProvider(ModelProvider):
    def __init__(self, config: Settings = settings):
        self.config = config
        if not config.deepseek_api_key:
            raise ProviderError("DEEPSEEK_API_KEY 未配置")

    async def _request(self, payload: dict[str, Any]) -> dict[str, Any]:
        last_error: Exception | None = None
        for attempt in range(self.config.model_max_retries + 1):
            try:
                async with httpx.AsyncClient(
                    base_url=self.config.deepseek_base_url,
                    timeout=self.config.model_timeout_seconds,
                    headers={"Authorization": f"Bearer {self.config.deepseek_api_key}"},
                ) as client:
                    response = await client.post("/chat/completions", json=payload)
                    response.raise_for_status()
                    return response.json()
            except (httpx.HTTPError, ValueError) as error:
                last_error = error
                if attempt < self.config.model_max_retries:
                    await asyncio.sleep(0.5 * (2**attempt))
        raise ProviderError(f"模型请求失败: {last_error}")

    async def generate_text(self, messages: list[dict[str, str]], **kwargs: Any) -> str:
        role = kwargs.pop("role", "default")
        model = kwargs.pop("model", None) or self.config.model_for(role)
        if not model:
            raise ProviderError("未配置 DeepSeek 模型名称")
        result = await self._request({
            "model": model, "messages": messages,
            "temperature": kwargs.pop("temperature", self.config.model_temperature), **kwargs,
        })
        return str(result["choices"][0]["message"]["content"])

    async def generate_json(
        self, messages: list[dict[str, str]], schema: type[BaseModel], **kwargs: Any
    ) -> dict[str, Any]:
        schema_instruction = (
            "仅返回符合以下 JSON Schema 的 JSON，不要使用 Markdown："
            + json.dumps(schema.model_json_schema(), ensure_ascii=False)
        )
        content = await self.generate_text(
            [*messages, {"role": "system", "content": schema_instruction}],
            response_format={"type": "json_object"}, **kwargs,
        )
        try:
            parsed = json.loads(content)
            return schema.model_validate(parsed).model_dump(mode="json")
        except (json.JSONDecodeError, ValueError) as error:
            raise ProviderError(f"模型 JSON 输出不符合 Schema: {error}") from error

    async def call_tools(
        self, messages: list[dict[str, str]], tools: list[dict[str, Any]], **kwargs: Any
    ) -> dict[str, Any]:
        model = kwargs.pop("model", None) or self.config.model_for(kwargs.pop("role", "default"))
        result = await self._request({"model": model, "messages": messages, "tools": tools, **kwargs})
        return dict(result["choices"][0]["message"])


class MockProvider(ModelProvider):
    async def generate_text(self, messages: list[dict[str, str]], **kwargs: Any) -> str:
        del kwargs
        subject = messages[-1]["content"][:80] if messages else "当前项目"
        return f"Mock Provider 已基于 ProjectSpec 处理：{subject}"

    async def generate_json(
        self, messages: list[dict[str, str]], schema: type[BaseModel], **kwargs: Any
    ) -> dict[str, Any]:
        del messages, kwargs
        example = schema.model_json_schema().get("examples", [{}])[0]
        return schema.model_validate(example).model_dump(mode="json")

    async def call_tools(
        self, messages: list[dict[str, str]], tools: list[dict[str, Any]], **kwargs: Any
    ) -> dict[str, Any]:
        del messages, kwargs
        return {"role": "assistant", "tool_calls": [], "available_tools": [x.get("name") for x in tools]}


def get_provider(config: Settings = settings) -> ModelProvider:
    if config.model_provider.lower() == "deepseek":
        return DeepSeekProvider(config)
    return MockProvider()
