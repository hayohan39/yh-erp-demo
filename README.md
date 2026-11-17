# YH 통합 ERP — 시뮬레이션 데모

골판지 회사 통합 ERP 재구축의 1차 목표인 **웹 기반 통합 ERP 시뮬레이션 데모**입니다. 레거시 시스템(OMS, MES, PMS, 설비, 위아고, 로지스팟, 오토콘, 더존)은 **I/F 시뮬레이터**가 대신하며, 실제 연동 규격(공통 메시지 봉투, 송수신 이력, 중복 방지, 재처리)대로 ERP와 데이터를 주고받습니다.

- 데모: 2026-12-01, 경영진 대상 시연 (11/27 기능 동결)
- 계획서: [골판지 통합 ERP 시뮬레이션 데모 계획서](https://claude.ai/artifact/Nq4SzMRmSjDsSkdoRBchTL)

## 구성

```
[브라우저] ── web(nginx + React) ──┬── /api      → backend  (FastAPI, ERP 본체) ── PostgreSQL 16
                                   └── /api/sim  → simulator(FastAPI, 레거시 대역)
              simulator ── IF-xxx 수신 ──▶ backend /api/if/inbound
              backend   ── IF-xxx 송신 ──▶ simulator /api/sim/inbound
```

| 디렉터리 | 내용 |
| --- | --- |
| `backend/` | ERP API. `app/interfaces/` I/F 게이트웨이·18종 카탈로그·핸들러, `app/models/` ORM(PostgreSQL, 테스트는 SQLite), `app/seed.py` 가상 기준정보 |
| `simulator/` | 레거시 I/F 시뮬레이터. 시작·정지·배속·수동 주문·데모 초기화 |
| `frontend/` | React + TypeScript + Ant Design. 9개 모듈 메뉴, 대시보드, 수주 현황, 기준정보, I/F 모니터, 시뮬레이터 제어 |
| `docker-compose.yml` | db(PostgreSQL) · backend · simulator · web 4개 서비스 |
| `scripts/deploy.sh` | 클라우드 서버 배포 스크립트 (Actions가 실행) |
| `docs/aws-lightsail-setup.md` | **AWS 계정·Lightsail 서버·시크릿 설정 안내** |

## 실행 환경

모든 실행은 클라우드에서 합니다. 개인 PC에 설치할 것은 없습니다.

- **배포**: AWS Lightsail 서버(2GB, 월 $12, 신규 가입 크레딧으로 충당) 1대. 리전은 계정에 지정된 곳(한국 가입 시 대개 시드니). `main` 머지 시 GitHub Actions가 자동 배포합니다. 최초 설정은 [docs/aws-lightsail-setup.md](docs/aws-lightsail-setup.md)를 따르세요.
- **검증**: PR마다 GitHub Actions(CI)가 백엔드 테스트, 프론트 빌드, PostgreSQL 포함 전체 스택 기동과 주문 I/F 흐름을 확인합니다.

## 지금 동작하는 흐름

1. **수주**: 시뮬레이터(OMS)가 `IF-OMS-01` 주문접수를 보냄 → ERP 수주 등록 → `IF-OMS-02` 수주확정 회신
2. **스케쥴링**: 수주접수 상태의 수주를 원단 규격별로 묶어 원지 폭(1,600~2,400mm) 안에 최대 2품목을 배치하는 폭 조합을 계산하고, 품목별 단독 생산(수작업 가정) 대비 트림 손실과 원지 절감액을 보여줌 (`app/services/scheduling.py`)
3. **생산지시**: 스케쥴 확정 → 수주 라인별 생산지시(골판지기 → 인쇄 → 가공) 생성 → `IF-MES-01`, `IF-EQ-01`(골게터), `IF-EXT-03`(오토콘), `IF-PMS-02`(원지 소요량), `IF-EQ-05`(인쇄), `IF-EQ-03`(에볼) 송신
4. **설비 실적**: 시뮬레이터가 설비별로 순서대로 생산하며 가동상태·실적을 보냄 (`IF-EQ-02/04/06`, `IF-PMS-01` 원지 투입, `IF-EXT-04` 이송, `IF-MES-02` 완료보고) → 공정 진도 보드 실시간 갱신, 제품 재고 입고, 수주 생산완료와 `IF-OMS-02` 진도 회신
5. **품질**: 공정 불량률이 3% 이상이면 불량이 자동 등록되고 모든 화면에 알림 → 불량·대책 화면에서 원인·대책 등록. 시뮬레이터 제어의 "다음 인쇄 작업 불량 발생"으로 시연 장면을 만들 수 있음
6. **연동 관리**: 모든 I/F가 `if_message`에 기록되고, 실패 건 재처리와 중복 수신 무시

I/F 18종 중 14종이 동작합니다. 출하(`IF-EXT-02` 로지스팟), 매출마감(`IF-OMS-03`), 세금계산서(`IF-EXT-01` 위아고), 더존 전표(`IF-EXT-05`)와 원가분석은 다음 단계에서 붙입니다.

## 주요 API

| 경로 | 설명 |
| --- | --- |
| `GET /api/health` | 상태 (DB 종류 포함) |
| `POST /api/if/inbound` | 레거시 → ERP 수신 (공통 봉투) |
| `GET /api/if/catalog` · `/api/if/messages` | I/F 18종 현황, 송수신 이력 |
| `POST /api/if/messages/{id}/retry` | 실패 건 재처리 |
| `GET /api/events` | SSE 실시간 이벤트 |
| `POST /api/scheduling/plans` · `/plans/{no}/confirm` | 폭 조합 계산, 확정(생산지시 발행) |
| `GET /api/production/work-orders` · `/board` | 생산지시, 공정 진도 보드 |
| `GET /api/quality/defects` · `POST /defects/{no}/action` | 불량 목록, 대책 등록 |
| `POST /api/admin/reset` | 데모 초기화 |
| `POST /api/sim/start` · `/stop` · `/speed` · `/oms/order` · `/defect-spike` · `/reset` | 시뮬레이터 제어 |

API 문서(Swagger)는 배포 주소의 `/api/docs` 에서 볼 수 있습니다.
