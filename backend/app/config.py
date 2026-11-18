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
    # 로그인 토큰 서명 키. 공개 저장소에 고정값을 두면 누구나 토큰을 위조할 수 있으므로 기본값은 비워 두고,
    # 비어 있으면 서버가 켜질 때 무작위 키를 만든다(서버 재시작 시 다시 로그인).
    auth_secret: str = ""
    auth_token_hours: int = 12


settings = Settings()
