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
    # 로그인 토큰 서명 키. 서버에서는 .env의 AUTH_SECRET으로 바꿔 두는 것을 권장.
    auth_secret: str = "yh-erp-demo-auth-secret"
    auth_token_hours: int = 12


settings = Settings()
