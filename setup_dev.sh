#!/bin/bash
# Preter 개발환경 셋업 스크립트
# 실행: bash setup_dev.sh

set -e  # 에러 발생 시 중단

echo "=============================="
echo " Preter 개발환경 셋업 시작"
echo "=============================="

# ── 1. Homebrew ──────────────────────────────────────────────
if ! command -v brew &>/dev/null; then
  echo ""
  echo "[1/7] Homebrew 설치 중..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Intel Mac 기본 경로 설정
  eval "$(/usr/local/bin/brew shellenv)" 2>/dev/null || eval "$(/opt/homebrew/bin/brew shellenv)" 2>/dev/null
else
  echo "[1/7] Homebrew 이미 설치됨 ✓"
fi

# ── 2. Node.js (LTS) ─────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo ""
  echo "[2/7] Node.js LTS 설치 중..."
  brew install node
else
  echo "[2/7] Node.js 이미 설치됨 ($(node --version)) ✓"
fi

# ── 3. Python 3.11 ───────────────────────────────────────────
# 시스템 Python 3.9는 너무 낮음 — FastAPI/google-genai는 3.10+ 필요
if ! command -v python3.11 &>/dev/null; then
  echo ""
  echo "[3/7] Python 3.11 설치 중..."
  brew install python@3.11
  # PATH 우선순위 설정 (brew python이 시스템 python보다 앞서도록)
  echo 'export PATH="/usr/local/opt/python@3.11/bin:$PATH"' >> ~/.zshrc
  export PATH="/usr/local/opt/python@3.11/bin:$PATH"
else
  echo "[3/7] Python 3.11 이미 설치됨 ✓"
fi

PYTHON=python3.11

# ── 4. Docker Desktop ────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  echo ""
  echo "[4/7] Docker Desktop 설치 중... (용량 약 600MB, 시간이 걸릴 수 있습니다)"
  brew install --cask docker
  echo "  → Docker Desktop을 처음 실행하려면 Applications에서 Docker.app을 열어주세요."
else
  echo "[4/7] Docker 이미 설치됨 ✓"
fi

# ── 5. Google Cloud SDK ──────────────────────────────────────
if ! command -v gcloud &>/dev/null; then
  echo ""
  echo "[5/7] Google Cloud SDK 설치 중..."
  brew install --cask google-cloud-sdk
  # gcloud PATH 설정
  GCLOUD_PATH="$(brew --prefix)/share/google-cloud-sdk"
  echo "source '${GCLOUD_PATH}/path.zsh.inc'" >> ~/.zshrc
  echo "source '${GCLOUD_PATH}/completion.zsh.inc'" >> ~/.zshrc
  source "${GCLOUD_PATH}/path.zsh.inc" 2>/dev/null || true
else
  echo "[5/7] gcloud 이미 설치됨 ✓"
fi

# ── 6. Expo CLI ──────────────────────────────────────────────
if ! command -v expo &>/dev/null; then
  echo ""
  echo "[6/7] Expo CLI 설치 중..."
  npm install -g expo-cli eas-cli
else
  echo "[6/7] Expo CLI 이미 설치됨 ✓"
fi

# ── 7. Python 패키지 (백엔드용) ──────────────────────────────
echo ""
echo "[7/7] Python 백엔드 패키지 설치 중..."
$PYTHON -m pip install --upgrade pip

# requirements.txt 가 없으면 기본 패키지 설치
if [ -f "requirements.txt" ]; then
  $PYTHON -m pip install -r requirements.txt
else
  $PYTHON -m pip install \
    fastapi==0.115.0 \
    uvicorn[standard]==0.30.6 \
    websockets==12.0 \
    google-genai==0.8.0 \
    supabase==2.7.4 \
    python-jose[cryptography]==3.3.0 \
    python-multipart==0.0.9 \
    google-cloud-storage==2.18.2 \
    pydantic==2.8.2 \
    httpx==0.27.2 \
    python-dotenv==1.0.1

  echo ""
  echo "  → requirements.txt 생성 중 (버전 고정)..."
  $PYTHON -m pip freeze > requirements.txt
  echo "  → requirements.txt 생성 완료 ✓"
fi

# ── 완료 메시지 ──────────────────────────────────────────────
echo ""
echo "=============================="
echo " 설치 완료!"
echo "=============================="
echo ""
echo "다음 단계:"
echo "  1. 터미널을 재시작하거나 'source ~/.zshrc' 실행"
echo "  2. Applications에서 Docker.app 실행 (최초 1회)"
echo "  3. 'gcloud init' 으로 GCP 계정 연동"
echo "  4. .env.example 파일 복사 후 실제 키 입력:"
echo "     cp .env.example .env"
echo ""
echo "확인 명령어:"
echo "  node --version   # v20.x 이상"
echo "  python3.11 --version"
echo "  docker --version"
echo "  gcloud --version"
echo "  expo --version"
