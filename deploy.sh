#!/bin/bash
# Cloud Run 배포 스크립트. 값들은 CLAUDE.md "확정 사항"에 근거함 (임의 변경 금지).
set -e

PROJECT_ID="${GCP_PROJECT_ID:?GCP_PROJECT_ID 환경변수를 설정하세요}"
REGION="asia-northeast3"  # 서울 — Gemini Live API 호출이 Google 내부망을 경유하도록
SERVICE_NAME="preter-backend"
IMAGE="asia-northeast3-docker.pkg.dev/${PROJECT_ID}/preter/${SERVICE_NAME}:$(git rev-parse --short HEAD 2>/dev/null || date +%s)"

echo "Building image for linux/amd64 (Cloud Run은 x86_64)..."
docker build --platform linux/amd64 -t "$IMAGE" .

echo "Pushing image..."
docker push "$IMAGE"

echo "Deploying to Cloud Run..."
gcloud run deploy "$SERVICE_NAME" \
  --image "$IMAGE" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --platform managed \
  --timeout=3600 \
  --max-instances=1 \
  --min-instances=1 \
  --no-cpu-throttling \
  --allow-unauthenticated \
  --port=8080
