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
WEB_PORT="${WEB_PORT:-80}"
umask 077
cat > .env <<ENV
DB_USER=${DB_USER:-erp}
DB_PASSWORD=${DB_PASSWORD}
WEB_PORT=${WEB_PORT}
ENV

echo "[deploy] 빌드 및 기동"
$DOCKER compose up -d --build --remove-orphans
$DOCKER image prune -f >/dev/null

echo "[deploy] 헬스체크 대기"
for _ in $(seq 1 60); do
  if curl -fsS "http://localhost:${WEB_PORT}/api/health" >/dev/null 2>&1; then
    echo "[deploy] 완료"; $DOCKER compose ps; exit 0
  fi
  sleep 5
done
echo "[deploy] 헬스체크 실패"; $DOCKER compose logs --tail 80 backend; exit 1
