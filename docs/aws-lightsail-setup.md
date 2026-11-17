# AWS Lightsail 배포 안내

데모는 **AWS Lightsail 서울 리전 서버 1대**에서 Docker Compose로 돌아갑니다(웹·API·시뮬레이터·PostgreSQL). 사용자 PC에서는 아무것도 설치하거나 실행하지 않습니다. 아래는 모두 웹 브라우저(AWS 콘솔, GitHub)에서 하는 작업이고, 30분 정도 걸립니다.

한 번만 설정해 두면, 이후 `main` 브랜치에 PR이 머지될 때마다 GitHub Actions가 서버에 자동으로 배포합니다.

## 1. AWS 계정 만들기 (약 10분)

1. https://aws.amazon.com/ko/ → **무료 계정 생성**. 이메일, 카드, 휴대폰 인증이 필요합니다.
2. 가입 후 콘솔 오른쪽 위 리전을 **아시아 태평양(서울) ap-northeast-2** 로 둡니다.

## 2. 서버 만들기 (약 5분)

https://lightsail.aws.amazon.com → **Create instance**

| 항목 | 값 |
| --- | --- |
| Instance location | **Seoul (ap-northeast-2)** |
| Platform / Blueprint | **Linux/Unix → OS Only → Ubuntu 22.04 LTS** |
| SSH key pair | 기본 키(Default) 그대로 |
| Instance plan | **메모리 2 GB** 요금제 (월 $12 수준). 화면에 "First 3 months free"가 붙은 요금제인지 확인하세요 |
| Instance name | `yh-erp-demo` |

- 1 GB 이하 요금제는 이미지 빌드 중 메모리가 모자랄 수 있어 2 GB를 권장합니다.
- 데모가 끝나면 인스턴스를 **Delete** 하면 과금이 멈춥니다.

## 3. 고정 IP 붙이기 (약 2분, 무료)

서버를 재시작해도 주소가 바뀌지 않도록 합니다.

**Networking → Create static IP** → 방금 만든 `yh-erp-demo`에 연결 → 표시된 IP를 적어 둡니다.

웹 포트(80)는 Lightsail 기본 방화벽에서 이미 열려 있습니다. 인스턴스 → **Networking** 탭의 IPv4 Firewall에 `HTTP 80`이 있는지만 확인하세요.

## 4. SSH 키 받기 (약 1분)

**Account(오른쪽 위) → Account → SSH keys** → Seoul 리전의 **Default key** 옆 **Download** → `LightsailDefaultKey-ap-northeast-2.pem` 파일을 받습니다. GitHub Actions가 이 키로 서버에 접속해 배포합니다. 내용을 다음 단계에 붙여넣은 뒤 파일은 지워도 됩니다.

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

## 운영 메모

- 외부에는 웹(80)만 열려 있고, PostgreSQL과 API는 서버 내부 Docker 네트워크에서만 접근됩니다.
- DB 데이터는 Docker 볼륨 `db-data`에 남아 재배포해도 유지됩니다. 데모 전 상태로 되돌릴 때는 화면의 **연동·시스템 → 시뮬레이터 제어 → 데모 초기화** 버튼을 씁니다.
- 서버에 직접 들어가야 할 때는 Lightsail 콘솔 인스턴스 화면의 **Connect using SSH**(브라우저 터미널)를 씁니다.
- 도메인·HTTPS는 리허설 전에 필요하면 추가합니다.
