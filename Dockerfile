# Cloud Run은 x86_64이므로 빌드 시 항상
# `docker build --platform linux/amd64 .` 로 빌드할 것 (CLAUDE.md 확정 사항).
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Cloud Run이 PORT 환경변수로 리스닝 포트를 주입한다.
ENV PORT=8080
EXPOSE 8080

# WebSocket이 계속 열려있는 워크로드라 CPU "항상 할당" 모드로 배포해야 함
# (gcloud run deploy --no-cpu-throttling) — Dockerfile 자체로는 강제 불가하니
# 배포 스크립트/명령에서 반드시 지정.
# --proxy-headers --forwarded-allow-ips='*': Cloud Run의 프록시가 컨테이너에는 HTTP로
# 전달하지만 실제로는 HTTPS 요청이다. 이 플래그 없으면 request.url.scheme이 http로
# 잡혀서, sqladmin이 생성하는 CSS/JS 절대경로가 http://가 되어 HTTPS 페이지에서
# 믹스드 콘텐츠로 차단된다 (Cloud Run 단일 컨테이너 인그레스이므로 '*' 신뢰 안전).
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
