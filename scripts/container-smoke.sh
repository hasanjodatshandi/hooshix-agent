#!/bin/bash
# Checklist 12.6 / 12.8 / 12.9 — container build and smoke test.
#
# Runs inside WSL (Ubuntu) where the Docker daemon is reachable from this
# host. Proves the three items the checklist recorded as environment-BLOCKED:
#   12.6  the container runtime is non-root
#   12.8  the image boots and passes its own healthcheck
#   12.9  an authenticated operator session reaches the protected endpoints
#
# Usage:  wsl -d Ubuntu -e bash /mnt/d/workspace/hooshix-agent/scripts/container-smoke.sh
set -uo pipefail

IMAGE="hooshix-agent:smoke"
CONTAINER="hooshix-smoke-$$"
HOST_PORT="${HOOSHIX_HTTP_PORT:-30128}"

log() { echo "[smoke] $*"; }
fail() { echo "[smoke] FAIL: $*"; cleanup 1; }
cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker rmi -f "$IMAGE" >/dev/null 2>&1 || true
  exit "${1:-0}"
}
trap 'cleanup 1' INT TERM

REPO="$(cd "$(dirname "$0")/.." && pwd)"
log "building image from $REPO"
docker build -q -t "$IMAGE" "$REPO" >/dev/null || fail "image build failed"
log "image built"

log "12.8 starting container"
docker run -d --name "$CONTAINER" -p "$HOST_PORT:3001" "$IMAGE" >/dev/null || fail "container start failed"

# Wait for the healthcheck to report healthy (the Dockerfile polls /health/live).
for i in $(seq 1 40); do
  status="$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo missing)"
  [ "$status" = "healthy" ] && break
  sleep 1
done
[ "$status" = "healthy" ] || fail "container never became healthy (last: $status)"
log "12.8 PASS: container healthy"

log "12.6 verifying non-root runtime"
uid="$(docker exec "$CONTAINER" id -u 2>/dev/null || echo unknown)"
[ "$uid" = "1000" ] || fail "container runs as uid=$uid, expected 1000 (node)"
user="$(docker exec "$CONTAINER" id -un 2>/dev/null || echo unknown)"
[ "$user" = "node" ] || fail "container runs as user=$user, expected node"
log "12.6 PASS: non-root runtime (uid=$uid user=$user)"

log "5.12 verifying POSIX 0600 bootstrap secret permissions"
mode="$(docker exec "$CONTAINER" stat -c '%a' /app/data/.token 2>/dev/null || echo unknown)"
[ "$mode" = "600" ] || fail "bootstrap secret is mode $mode, expected 600"
log "5.12 PASS: bootstrap secret is 0600 inside the POSIX container"

log "12.9 authenticated operator smoke"
probe() {
  docker exec "$CONTAINER" node -e "$1" || fail "probe failed"
}

# Bootstrap secret must NOT be accepted as an MCP bearer (by design).
probe '
const TOKEN=require("fs").readFileSync("/app/data/.token","utf8");
fetch("http://127.0.0.1:3001/mcp",{method:"POST",headers:{Authorization:"Bearer "+TOKEN,"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-06-18",capabilities:{},clientInfo:{name:"smoke",version:"1"}}})})
.then(r=>{if(r.status!==401)process.exit(1);console.log("  bootstrap-as-bearer rejected: "+r.status)})
.catch(e=>process.exit(1));
' || fail "bootstrap token was accepted as MCP bearer"

# Operator login with the bootstrap secret issues a session cookie.
COOKIE_JSON="$(docker exec "$CONTAINER" node -e '
const http=require("http"),fs=require("fs");
const TOKEN=fs.readFileSync("/app/data/.token","utf8");
const body=new URLSearchParams({secret:TOKEN}).toString();
const req=http.request({host:"127.0.0.1",port:3001,path:"/operator/login",method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","Origin":"http://127.0.0.1:3001","Content-Length":Buffer.byteLength(body)}},res=>{
  const c=(res.headers["set-cookie"]||[])[0]||"";
  console.log(JSON.stringify({status:res.statusCode,cookie:c.split(";")[0]}));
  res.resume();
});
req.end(body);
')"
status="$(echo "$COOKIE_JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin)["status"])')"
cookie="$(echo "$COOKIE_JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin)["cookie"])')"
[ "$status" = "303" ] || fail "operator login returned $status, expected 303"
[ -n "$cookie" ] || fail "operator login issued no session cookie"
log "  operator login: 303 + session cookie"

# The session cookie must reach the protected monitoring endpoints.
# The cookie is embedded in the probe rather than passed as an env var so the
# check cannot silently lose the credential between bash and node.
COOKIE_ESCAPED="${cookie//\'/\\\'}"
probe "
const cookie='$COOKIE_ESCAPED';
Promise.all([
  fetch('http://127.0.0.1:3001/metrics',{headers:{Cookie:cookie}}).then(r=>['metrics',r.status]),
  fetch('http://127.0.0.1:3001/dashboard',{headers:{Cookie:cookie}}).then(r=>['dashboard',r.status]),
  fetch('http://127.0.0.1:3001/tools',{headers:{Cookie:cookie}}).then(r=>['tools',r.status]),
  fetch('http://127.0.0.1:3001/metrics').then(r=>['metrics-noauth',r.status]),
]).then(rs=>{rs.forEach(([n,s])=>console.log('  '+n+': '+s))})
.catch(e=>process.exit(1));
" || fail "session endpoints failed"

log "12.9 PASS: authenticated operator session works"
log "ALL CHECKS PASSED"
cleanup 0
