# YH 통합 ERP — 시뮬레이션 데모

골판지 회사 통합 ERP 재구축의 1차 목표인 **웹 기반 통합 ERP 시뮬레이션 데모**입니다. 레거시 시스템(OMS, MES, PMS, 설비, 위아고, 로지스팟, 오토콘, 더존)은 **I/F 시뮬레이터**가 대신하며, 실제 연동 규격(공통 메시지 봉투, 송수신 이력, 중복 방지, 재처리)대로 ERP와 데이터를 주고받습니다.

- 데모: 2026-12-01, 경영진 대상 시연 (11/27 기능 동결)
- 계획서: [골판지 통합 ERP 시뮬레이션 데모 계획서](https://claude.ai/artifact/Nq4SzMRmSjDsSkdoRBchTL)

## 구성

```
[브라우저] ── web(nginx + React) ──┬── /api      → backend  (FastAPI, ERP 본체) ── Oracle Database Free 23ai
                                   └── /api/sim  → simulator(FastAPI, 레거시 대역)
              simulator ── IF-xxx 수신 ──▶ backend /api/if/inbound
              backend   ── IF-xxx 송신 ──▶ simulator /api/sim/inbound
```

| 디렉터리 | 내용 |
| --- | --- |
| `backend/` | ERP API. `app/interfaces/` I/F 게이트웨이·18종 카탈로그·핸들러, `app/models/` ORM(Oracle), `app/seed.py` 가상 기준정보 |
| `simulator/` | 레거시 I/F 시뮬레이터. 시작·정지·배속·수동 주문·데모 초기화 |
| `frontend/` | React + TypeScript + Ant Design. 9개 모듈 메뉴, 대시보드, 수주 현황, 기준정보, I/F 모니터, 시뮬레이터 제어 |
| `docker-compose.yml` | oracle · backend · simulator · web 4개 서비스 |
| `scripts/deploy.sh` | Oracle Cloud VM 배포 스크립트 (Actions가 실행) |
| `docs/oracle-cloud-setup.md` | **OCI 계정·VM·시크릿 설정 안내** |

## 실행 환경

모든 실행은 클라우드에서 합니다. 개인 PC에 설치할 것은 없습니다.

- **배포**: Oracle Cloud VM(Ampere A1, Always Free) 1대. `main` 머지 시 GitHub Actions가 자동 배포합니다. 최초 설정은 [docs/oracle-cloud-setup.md](docs/oracle-cloud-setup.md)를 따르세요.
- **검증**: PR마다 GitHub Actions(CI)가 백엔드 테스트, 프론트 빌드, Oracle 포함 전체 스택 기동과 주문 I/F 흐름을 확인합니다.

## 지금 동작하는 흐름

1. 시뮬레이터(OMS)가 `IF-OMS-01` 주문접수를 보냄 → ERP가 `if_message`에 기록하고 수주(`sales_order`) 등록
2. ERP가 `IF-OMS-02` 진도정보(수주확정)를 OMS로 회신
3. 대시보드·수주 현황·I/F 모니터가 SSE로 실시간 갱신
4. 잘못된 메시지는 FAILED로 남고 I/F 모니터에서 재처리, 같은 `message_id`는 중복 수신 무시

생산·출하·스케쥴링·원가 모듈은 같은 구조(I/F 핸들러 + 모델 + 화면)로 이어서 붙입니다.

## 주요 API

| 경로 | 설명 |
| --- | --- |
| `GET /api/health` | 상태 (DB 종류 포함) |
| `POST /api/if/inbound` | 레거시 → ERP 수신 (공통 봉투) |
| `GET /api/if/catalog` · `/api/if/messages` | I/F 18종 현황, 송수신 이력 |
| `POST /api/if/messages/{id}/retry` | 실패 건 재처리 |
| `GET /api/events` | SSE 실시간 이벤트 |
| `POST /api/admin/reset` | 데모 초기화 |
| `POST /api/sim/start` · `/stop` · `/speed` · `/oms/order` · `/reset` | 시뮬레이터 제어 |

API 문서(Swagger)는 배포 주소의 `/api/docs` 에서 볼 수 있습니다.
