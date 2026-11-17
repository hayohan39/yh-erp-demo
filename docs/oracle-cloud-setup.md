# Oracle Cloud 배포 안내

데모는 **Oracle Cloud(OCI) VM 1대**에서 Docker Compose로 돌아갑니다. 사용자 PC에서는 아무것도 설치하거나 실행하지 않습니다. 아래는 모두 웹 브라우저(OCI 콘솔, GitHub)에서 하는 작업입니다.

한 번만 설정해 두면, 이후 `main` 브랜치에 PR이 머지될 때마다 GitHub Actions가 VM에 자동으로 배포합니다.

## 1. OCI 계정 만들기 (약 15분)

1. https://www.oracle.com/kr/cloud/free/ 에서 **무료로 시작하기**.
2. 홈 리전은 **South Korea Central (Chuncheon)** 또는 **South Korea North (Seoul)** 를 고릅니다. 나중에 바꿀 수 없습니다.
3. 카드 인증이 필요하지만 Always Free 범위 안에서는 과금되지 않습니다.

## 2. VM 만들기 (약 10분)

OCI 콘솔 → **Compute → Instances → Create instance**

| 항목 | 값 |
| --- | --- |
| Name | `yh-erp-demo` |
| Image | **Canonical Ubuntu 22.04** (또는 24.04) |
| Shape | **Ampere → VM.Standard.A1.Flex**, OCPU **4**, Memory **24 GB** (Always Free 한도) |
| Networking | 기본 VCN 생성, **Assign a public IPv4 address** 체크 |
| SSH keys | **Generate a key pair for me** → **Save private key** 로 개인키 파일을 받아 둡니다 |
| Boot volume | 기본값(약 47 GB)으로 충분, 100 GB까지 무료 |

- "Out of capacity" 오류가 나면 Availability Domain을 바꿔 다시 시도하거나, 시간을 두고 재시도하세요. 계정을 Pay As You Go로 올리면 잘 잡히고, Always Free 한도 안에서는 여전히 무료입니다.
- 생성 후 인스턴스 상세 화면의 **Public IP address**를 적어 둡니다.

## 3. 80 포트 열기 (약 3분)

인스턴스 상세 → **Subnet** 링크 → **Security Lists → Default Security List → Add Ingress Rules**

- Source CIDR: `0.0.0.0/0`
- IP Protocol: TCP
- Destination Port Range: `80`

VM 내부 방화벽(iptables)은 배포 스크립트가 자동으로 엽니다.

## 4. GitHub 시크릿 등록 (약 5분)

GitHub 저장소 → **Settings → Secrets and variables → Actions → New repository secret**

| 이름 | 값 |
| --- | --- |
| `OCI_HOST` | 2단계의 Public IP |
| `OCI_SSH_KEY` | 2단계에서 받은 개인키 파일 내용 전체 (`-----BEGIN ... KEY-----` 부터 끝까지) |
| `OCI_USER` | `ubuntu` (Ubuntu 이미지 기본 계정, 생략 가능) |
| `ORACLE_PASSWORD` | Oracle SYS 비밀번호. 영문 대소문자+숫자 8자 이상 |
| `DB_PASSWORD` | ERP 앱 계정 비밀번호. 영문 대소문자+숫자 8자 이상 |

> 비밀번호에 작은따옴표(`'`)는 쓰지 마세요.

## 5. 첫 배포

GitHub 저장소 → **Actions → Deploy (Oracle Cloud) → Run workflow**.

첫 배포는 Docker 설치, 이미지 빌드, Oracle DB 초기화 때문에 10~15분 정도 걸립니다. 끝나면 워크플로 요약에 `데모 주소 http://<Public IP>/` 가 표시됩니다. 이후에는 `main`에 머지될 때마다 자동 배포됩니다.

## 운영 메모

- 외부에는 웹(80)만 열려 있고, Oracle DB(1521)와 API는 VM 내부 Docker 네트워크에서만 접근됩니다.
- DB 데이터는 Docker 볼륨 `oracle-data`에 남아 재배포해도 유지됩니다. 데모 전 상태로 되돌릴 때는 화면의 **연동·시스템 → 시뮬레이터 제어 → 데모 초기화** 버튼을 씁니다.
- VM에 직접 들어가야 할 때는 OCI 콘솔의 **Cloud Shell**(브라우저 터미널)에서 개인키로 접속할 수 있습니다.
- 도메인·HTTPS는 데모 리허설 전에 필요하면 추가합니다.
