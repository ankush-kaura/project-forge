#!/usr/bin/env python3
"""Helper script to call Hostinger MCP tools"""

import json
import subprocess
import yaml

# Read token from config
with open('/root/.hermes/config.yaml', 'r') as f:
    config = yaml.safe_load(f)
token = config['mcp_servers']['hostinger']['env']['HOSTINGER_API_TOKEN']

def call_tool(tool_name, arguments=None):
    """Call a Hostinger MCP tool"""
    if arguments is None:
        arguments = {}
    
    request = json.dumps({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": tool_name,
            "arguments": arguments
        }
    })
    
    result = subprocess.run(
        ["/root/.hermes/node/bin/hostinger-api-mcp", "--stdio"],
        input=request,
        capture_output=True,
        text=True,
        timeout=30,
        env={"HOSTINGER_API_TOKEN": token, "PATH": "/usr/local/bin:/usr/bin:/bin"}
    )
    
    for line in result.stdout.split('\n'):
        line = line.strip()
        if line.startswith('{'):
            data = json.loads(line)
            content = data.get('result', {}).get('content', [])
            if content:
                return json.loads(content[0].get('text', '{}'))
    
    return None

if __name__ == "__main__":
    import sys
    tool = sys.argv[1] if len(sys.argv) > 1 else "domains_getDomainListV1"
    args = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
    
    result = call_tool(tool, args)
    print(json.dumps(result, indent=2))
