from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    database_url: str = "sqlite:///./data/designer-prototype-agent.db"
    projects_root: Path = Path("./projects")
    model_provider: str = "mock"
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_default_model: str = ""
    deepseek_reasoning_model: str = ""
    deepseek_coding_model: str = ""
    model_timeout_seconds: float = 60
    model_max_retries: int = 2
    model_temperature: float = 0.2
    cors_origins: str = "http://localhost:3000,http://localhost:5173"

    def model_for(self, role: str) -> str:
        options = {
            "reasoning": self.deepseek_reasoning_model,
            "coding": self.deepseek_coding_model,
        }
        return options.get(role) or self.deepseek_default_model


settings = Settings()
