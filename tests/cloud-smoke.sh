#!/usr/bin/env bash
# 배포된 API 를 클라우드에서 확인한다 — tests/api.test.mjs 를 API_TARGET=cloud 로 돌리고,
# 테스트가 만든 사용자 데이터(Firestore)와 익명 계정(Auth)을 지운다. gcloud · firebase CLI 로그인이 필요하다.
set -uo pipefail
PROJECT=llmwiki-minsu
cd "$(dirname "$0")/.."
UIDS=$(mktemp)
API_TARGET=cloud API_TEST_UIDS_FILE="$UIDS" node --test tests/api.test.mjs
STATUS=$?

TOKEN=$(gcloud auth print-access-token 2>/dev/null)
while read -r uid; do
  [ -z "$uid" ] && continue
  firebase firestore:delete "users/$uid" --recursive --force --project "$PROJECT" >/dev/null 2>&1 && echo "지움: users/$uid"
  ids="${ids:-}\"$uid\","
done < "$UIDS"
if [ -n "${ids:-}" ]; then
  curl -s -X POST "https://identitytoolkit.googleapis.com/v1/projects/$PROJECT/accounts:batchDelete" \
    -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $PROJECT" -H "Content-Type: application/json" \
    -d "{\"localIds\":[${ids%,}],\"force\":true}" >/dev/null && echo "익명 계정 지움: $(grep -c . "$UIDS")개"
fi
rm -f "$UIDS"
exit $STATUS
