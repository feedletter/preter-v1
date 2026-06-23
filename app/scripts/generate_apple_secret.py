"""Apple Sign In용 client secret(JWT) 생성기.

Apple은 고정된 secret 문자열을 발급하지 않고, .p8 프라이빗 키로 직접
서명한 JWT를 client secret으로 사용해야 한다. 이 JWT는 최대 6개월
(15777000초)까지만 유효하므로 만료 전 재생성이 필요하다.

사용법:
    python app/scripts/generate_apple_secret.py \
        --key-path ~/Downloads/AuthKey_482V7XTJ99.p8 \
        --key-id 482V7XTJ99 \
        --team-id <APPLE_TEAM_ID> \
        --client-id com.preter.app   # 또는 등록한 Services ID
"""

import argparse
import time

import jwt


def generate_secret(key_path: str, key_id: str, team_id: str, client_id: str) -> str:
    with open(key_path) as f:
        private_key = f.read()

    now = int(time.time())
    payload = {
        "iss": team_id,
        "iat": now,
        "exp": now + 15777000,  # Apple 허용 최대치(6개월)
        "aud": "https://appleid.apple.com",
        "sub": client_id,
    }
    headers = {"kid": key_id, "alg": "ES256"}

    return jwt.encode(payload, private_key, algorithm="ES256", headers=headers)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--key-path", required=True, help=".p8 프라이빗 키 파일 경로")
    parser.add_argument("--key-id", required=True, help="Apple Developer의 Key ID")
    parser.add_argument("--team-id", required=True, help="Apple Developer Team ID (10자리)")
    parser.add_argument("--client-id", required=True, help="Services ID (Client ID)")
    args = parser.parse_args()

    secret = generate_secret(args.key_path, args.key_id, args.team_id, args.client_id)
    print(secret)
