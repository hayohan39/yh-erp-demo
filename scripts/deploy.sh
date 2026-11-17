#!/usr/bin/env bash
# Oracle Cloud VM(Ubuntu, Ampere A1 ARM)에서 실행되는 배포 스크립트.
# GitHub Actions 'Deploy' 워크플로가 소스를 VM에 복사한 뒤 SSH로 이 스크립트를 실행한다.
# 처음 실행 시 Docker 설치와 방화벽(80 포트) 개방까지 한 번에 처리한다.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null 2>&1; then
  echo "[deploy] Docker 설치"
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER" || true
fi
DOCKER="docker"
docker info >/dev/null 2>&1 || DOCKER="sudo docker"

# OCI Ubuntu 이미지는 iptables가 22번 외 포트를 막아 둔다. 웹 포트를 연다.
WEB_PORT="${WEB_PORT:-80}"
if ! sudo iptables -C INPUT -p tcp --dport "$WEB_PORT" -j ACCEPT 2>/dev/null; then
  echo "[deploy] 방화벽 ${WEB_PORT}/tcp 개방"
  sudo iptables -I INPUT 6 -p tcp -m state --state NEW --dport "$WEB_PORT" -j ACCEPT
  if command -v netfilter-persistent >/dev/null 2>&1; then sudo netfilter-persistent save; fi
fi

# 비밀번호는 워크플로가 환경변수로 넘긴다. .env는 VM에만 존재한다.
: "${ORACLE_PASSWORD:?ORACLE_PASSWORD가 필요합니다}"
: "${DB_PASSWORD:?DB_PASSWORD가 필요합니다}"
umask 077
cat > .env <<ENV
ORACLE_PASSWORD=${ORACLE_PASSWORD}
DB_USER=${DB_USER:-erp}
DB_PASSWORD=${DB_PASSWORD}
WEB_PORT=${WEB_PORT}
ENV

echo "[deploy] 빌드 및 기동"
$DOCKER compose up -d --build --remove-orphans
$DOCKER image prune -f >/dev/null

echo "[deploy] 헬스체크 대기 (Oracle 첫 기동은 수 분 걸릴 수 있음)"
for _ in $(seq 1 60); do
  if curl -fsS "http://localhost:${WEB_PORT}/api/health" >/dev/null 2>&1; then
    echo "[deploy] 완료"; $DOCKER compose ps; exit 0
  fi
  sleep 5
done
echo "[deploy] 헬스체크 실패"; $DOCKER compose logs --tail 80 backend; exit 1
