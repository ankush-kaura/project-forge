#!/bin/bash
# Helper script to call Hostinger MCP tools

TOKEN=$(python3 -c "import yaml; c=yaml.safe_load(open('/root/.hermes/config.yaml')); print(c['mcp_servers']['hostinger']['env']['HOSTINGER_API_TOKEN'])")

TOOL_NAME=${1:-"domains_getDomainListV1"}
ARGS=${2:-"{}"}

echo "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$TOOL_NAME\",\"arguments\":$ARGS}}" | \
  HOSTINGER_API_TOKEN="$TOKEN" timeout 30 hostinger-api-mcp --stdio 2>/dev/null | \
  python3 -c "
import json, sys
for line in sys.stdin:
    line = line.strip()
    if line.startswith('{'):
        data = json.loads(line)
        content = data.get('result',{}).get('content',[])
        if content:
            print(content[0].get('text',''))
        elif 'error' in data:
            print('Error:', json.dumps(data['error'], indent=2))
"
