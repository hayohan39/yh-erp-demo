#!/usr/bin/env bash
# 클라우드 서버(AWS Lightsail Ubuntu)에서 실행되는 배포 스크립트.
# GitHub Actions 'Deploy' 워크플로가 소스를 서버에 복사한 뒤 SSH로 이 스크립트를 실행한다.
# 처음 실행 시 Docker 설치와 스왑 설정까지 한 번에 처리한다.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null 2>&1; then
  echo "[deploy] Docker 설치"
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER" || true
fi
DOCKER="docker"
docker info >/dev/null 2>&1 || DOCKER="sudo docker"

# 소형 인스턴스에서 이미지 빌드 시 메모리 부족을 막기 위한 2GB 스왑
if [ ! -f /swapfile ]; then
  echo "[deploy] 스왑 2GB 설정"
  if sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile; then
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  else
    echo "[deploy] 스왑 설정 실패, 계속 진행"; sudo rm -f /swapfile
  fi
fi

# 비밀번호는 워크플로가 환경변수로 넘긴다. .env는 서버에만 존재한다.
: "${DB_PASSWORD:?DB_PASSWORD가 필요합니다}"
# HTTPS: 고정 IP로 무료 도메인(sslip.io)을 만들고 Caddy가 Let's Encrypt 인증서를 자동 발급한다.
# 예) 13.54.1.2 → 13-54-1-2.sslip.io. DEMO_HOST가 도메인이면 그대로 쓴다.
DEMO_HOST="${DEMO_HOST:-$(curl -fsS -m 5 https://checkip.amazonaws.com || true)}"
if [[ "$DEMO_HOST" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  SITE_DOMAIN="${DEMO_HOST//./-}.sslip.io"
else
  SITE_DOMAIN="$DEMO_HOST"
fi
: "${SITE_DOMAIN:?서버 주소를 알 수 없습니다}"
umask 077
cat > .env <<ENV
DB_USER=${DB_USER:-erp}
DB_PASSWORD=${DB_PASSWORD}
WEB_PORT=127.0.0.1:8080
COMPOSE_PROFILES=https
SITE_DOMAIN=${SITE_DOMAIN}
ENV

echo "[deploy] 빌드 및 기동"
$DOCKER compose up -d --build --remove-orphans
$DOCKER image prune -f >/dev/null

echo "[deploy] 헬스체크 대기"
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:8080/api/health" >/dev/null 2>&1; then
    echo "[deploy] 앱 기동 완료"; $DOCKER compose ps
    echo "[deploy] HTTPS 인증서 확인"
    for _ in $(seq 1 24); do
      if curl -fsS -m 5 --resolve "${SITE_DOMAIN}:443:127.0.0.1" "https://${SITE_DOMAIN}/api/health" >/dev/null 2>&1; then
        echo "[deploy] HTTPS 정상"; exit 0
      fi
      sleep 5
    done
    echo "::warning::HTTPS 인증서를 아직 받지 못했습니다. http 접속은 됩니다."
    $DOCKER compose logs --tail 30 caddy; exit 0
  fi
  sleep 5
done
echo "[deploy] 헬스체크 실패"; $DOCKER compose logs --tail 80 backend; exit 1
