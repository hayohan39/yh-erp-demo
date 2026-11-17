from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """환경변수로 주입되는 설정. Compose(.env)에서 값을 넣는다."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "YH 통합 ERP (시뮬레이션 데모)"
    # 예: postgresql+psycopg://erp:pw@db:5432/erp (테스트는 SQLite)
    database_url: str = "sqlite:///./erp-dev.db"
    db_connect_retries: int = 60
    seed_on_startup: bool = True
    cors_origins: str = "*"
    # ERP → 레거시 송신 대상. 데모에서는 I/F 시뮬레이터의 수신 엔드포인트.
    legacy_outbound_url: str = ""


settings = Settings()
