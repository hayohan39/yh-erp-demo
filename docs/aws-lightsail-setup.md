# AWS Lightsail 배포 안내 (2026년 11월 기준)

데모는 **AWS Lightsail 서버 1대**에서 Docker Compose로 돌아갑니다(웹·API·시뮬레이터·PostgreSQL). 사용자 PC에서는 아무것도 설치하거나 실행하지 않습니다. 아래는 모두 웹 브라우저(AWS 콘솔, GitHub)에서 하는 작업이고, 30분 정도 걸립니다.

한 번만 설정해 두면, 이후 `main` 브랜치에 PR이 머지될 때마다 GitHub Actions가 서버에 자동으로 배포합니다.

## 먼저 알아 둘 점: 무료 범위가 바뀌었습니다

- 예전에 있던 **Lightsail 요금제별 "3개월 무료" 체험은 신규 가입자에게 더 이상 제공되지 않습니다.** AWS 프리 티어 크레딧으로 대체되었습니다.
- 새 AWS 계정은 가입할 때 **$100 크레딧**을 받고, 콘솔의 Explore AWS 과제를 하면 **최대 $100**를 더 받습니다(합계 최대 $200). Lightsail 요금도 이 크레딧에서 차감됩니다.
- 이 데모에 쓰는 2 GB 서버는 **월 $12**입니다. 12월 1일 데모까지 약 한 달 반을 써도 $20 안팎이라 **가입 크레딧 안에서 해결**됩니다.
- 가입할 때 **Free plan**과 **Paid plan** 중에서 고릅니다.
  - **Free plan (데모용으로 추천)**: 크레딧이 남아 있는 동안만 쓰고, 그 이상은 청구되지 않습니다. 대신 **가입 후 6개월이 지나거나 크레딧을 다 쓰면 계정이 정지**되고, 90일 안에 Paid plan으로 올리지 않으면 자원이 삭제됩니다.
  - **Paid plan**: 크레딧을 다 쓰면 카드로 청구됩니다. 데모 이후에도 서버를 계속 운영하려면 나중에 Free plan에서 Paid plan으로 올리면 됩니다(반대로는 못 바꿉니다).

### 리전은 고를 수 없을 수 있습니다

2026년 9월부터 AWS 기본 가입 방식(**Sign up for AWS (new)**)으로 만든 계정은 리전을 직접 고를 수 없고, 연락처 주소의 국가에 따라 **미국 동부(오하이오)·유럽(스톡홀름)·아시아 태평양(시드니)** 중 하나로 자동 지정됩니다. 서울(ap-northeast-2)은 이 목록에 없습니다. 한국 주소로 가입했다면 대개 **시드니(ap-southeast-2)** 입니다.

- 지정된 리전 확인: https://settings.aws.com → **Projects** → 프로젝트 → **Overview**의 **Additional Info** → **Region**
- **데모에는 지정된 리전을 그대로 쓰면 됩니다.** 한국에서 시드니까지 응답이 0.1~0.2초 정도 늦어지지만 화면 조작에는 거의 느껴지지 않습니다.
- 서울을 꼭 써야 한다면 계정의 **고급 기능(advanced features)** 을 켜야 합니다. 이때는 Paid plan으로 먼저 올려야 하고, 지출 한도가 사라지며, **되돌릴 수 없습니다.** 데모 단계에서는 권하지 않습니다.

## 1. AWS 계정 만들기 (약 10분)

1. https://aws.amazon.com/ko/free/ → **무료로 시작하기**. 이메일, 카드, 휴대폰 인증이 필요합니다. 카드는 본인 확인용이고, Free plan에서는 크레딧을 넘는 청구가 없습니다.
2. 플랜 선택 화면에서 **Free plan**을 고릅니다.
3. 가입이 끝나면 콘솔 홈의 **Explore AWS** 위젯에서 과제를 몇 개 해 두면 크레딧이 늘어납니다(선택).

## 2. 서버 만들기 (약 5분)

https://lightsail.aws.amazon.com → **Create instance**

| 항목 | 값 |
| --- | --- |
| Instance location | 계정에 지정된 리전 그대로 (예: **Sydney, ap-southeast-2**) |
| Select a platform | **Linux/Unix** |
| Select a blueprint | **Operating System (OS) only → Ubuntu 24.04 LTS** |
| SSH key pair | 기본 키(Default) 그대로 |
| Network type | **Dual-stack** (기본값). IPv6 only 요금제는 고정 IPv4를 붙일 수 없어 쓰지 않습니다 |
| Instance plan | **General purpose → $12 USD (2 GB 메모리, 2 vCPU, 60 GB SSD)** |
| Instance name | `yh-erp-demo` |

- 1 GB 이하 요금제는 이미지 빌드 중 메모리가 모자랄 수 있어 2 GB를 권장합니다.
- 서버는 **멈춰 둬도(Stop) 요금이 나갑니다.** 데모가 끝나면 **Delete** 해야 차감이 멈춥니다.

## 3. 고정 IP 붙이기 (약 2분)

서버를 재시작해도 주소가 바뀌지 않도록 합니다. 서버에 붙어 있는 동안은 무료입니다(떼어 둔 채 1시간이 넘으면 과금).

왼쪽 메뉴 **Networking → Create static IP** → 서버와 같은 리전 → 연결할 인스턴스 `yh-erp-demo` 선택 → 이름 입력(예: `yh-erp-demo-ip`) → **Create**. 표시된 IP를 적어 둡니다.

웹 포트(80)는 Lightsail 기본 방화벽에서 이미 열려 있습니다. 인스턴스 화면 → **Networking** 탭 → IPv4 Firewall에 `HTTP 80`이 있는지만 확인하세요.

## 4. SSH 키 받기 (약 1분)

오른쪽 위 **사용자 이름 → Account → SSH keys** 탭 → **Default keys**에서 서버와 같은 리전(예: ap-southeast-2) 키의 **다운로드 아이콘**을 누르면 `.pem` 파일을 받습니다. GitHub Actions가 이 키로 서버에 접속해 배포합니다. 내용을 다음 단계에 붙여넣은 뒤 파일은 지워도 됩니다.

## 5. GitHub 시크릿 등록 (약 5분)

GitHub 저장소 → **Settings → Secrets and variables → Actions → New repository secret**

| 이름 | 값 |
| --- | --- |
| `DEPLOY_HOST` | 3단계의 고정 IP |
| `DEPLOY_SSH_KEY` | 4단계 `.pem` 파일 내용 전체 (`-----BEGIN ... KEY-----` 부터 끝까지) |
| `DB_PASSWORD` | 데모 DB 비밀번호. 영문·숫자 12자 이상, 작은따옴표(`'`) 제외 |

서버 계정은 Ubuntu 기본값 `ubuntu`를 씁니다. 다르면 `DEPLOY_USER` 시크릿을 추가하세요.

## 6. 첫 배포

GitHub 저장소 → **Actions → Deploy → Run workflow**.

첫 배포는 Docker 설치와 이미지 빌드 때문에 10분 정도 걸립니다. 끝나면 워크플로 요약에 `데모 주소 http://<고정 IP>/` 가 표시됩니다. 이후에는 `main`에 머지될 때마다 자동 배포됩니다.

## 비용 확인

- 남은 크레딧과 만료일: AWS 콘솔 → **Billing and Cost Management → Credits**
- Free plan 남은 기간: 콘솔 홈의 Free plan 안내 위젯

## 운영 메모

- 외부에는 웹(80)만 열려 있고, PostgreSQL과 API는 서버 내부 Docker 네트워크에서만 접근됩니다.
- DB 데이터는 Docker 볼륨 `db-data`에 남아 재배포해도 유지됩니다. 데모 전 상태로 되돌릴 때는 화면의 **연동·시스템 → 시뮬레이터 제어 → 데모 초기화** 버튼을 씁니다.
- 서버에 직접 들어가야 할 때는 Lightsail 인스턴스 화면의 **Connect using SSH**(브라우저 터미널)를 씁니다.
- 도메인·HTTPS는 리허설 전에 필요하면 추가합니다.

## 참고한 공식 문서

- [AWS Free Tier](https://aws.amazon.com/free/) · [Free Tier FAQ](https://aws.amazon.com/free/free-tier-faqs/) · [Lightsail 무료 안내](https://aws.amazon.com/free/compute/lightsail/)
- [Lightsail 요금](https://aws.amazon.com/lightsail/pricing/) · [Lightsail 결제 FAQ](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-frequently-asked-questions-faq-billing-and-account-management.html)
- [가입 방식 비교](https://docs.aws.amazon.com/accounts/latest/reference/sign-up-for-aws.html) · [프로젝트 리전](https://docs.aws.amazon.com/accounts/latest/reference/project-regions.html) · [고급 기능 활성화](https://docs.aws.amazon.com/accounts/latest/reference/activate-advanced-features.html)
- [고정 IP 만들기](https://docs.aws.amazon.com/lightsail/latest/userguide/lightsail-create-static-ip.html) · [SSH 키 관리](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-managing-ssh-keys.html)
