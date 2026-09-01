#!/bin/bash
cd /opt/dsh-mobile/server
TOK=$(node -p "JSON.parse(require('fs').readFileSync('tokens.json','utf8')).tokens[0]")
echo "TOKEN=$TOK"
echo '=BIND='; curl -s -c /tmp/cj -X POST http://127.0.0.1:8788/api/auth/device-bind -H 'Content-Type: application/json' -d "{\"token\":\"$TOK\"}"; echo
echo '=ME='; curl -s -b /tmp/cj http://127.0.0.1:8788/api/auth/me; echo
echo '=LIST='; curl -s -b /tmp/cj -X POST http://127.0.0.1:8788/api/session.list -H 'Content-Type: application/json' -d '{"type":"client-request","rpcId":"t","method":"session.list","payload":{}}' | head -c 300; echo
