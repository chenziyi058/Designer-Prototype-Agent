import pytest

from app.config import Settings
from app.providers import MockProvider, ProviderError, get_provider


@pytest.mark.asyncio
async def test_mock_provider_text():
    text = await MockProvider().generate_text([{"role": "user", "content": "生成架构"}])
    assert "Mock Provider" in text


def test_deepseek_requires_key():
    with pytest.raises(ProviderError):
        get_provider(Settings(model_provider="deepseek", deepseek_api_key=""))


def test_default_model_fallback():
    config = Settings(deepseek_default_model="default-model", deepseek_reasoning_model="")
    assert config.model_for("reasoning") == "default-model"
    assert config.model_for("coding") == "default-model"
