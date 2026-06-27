#!/usr/bin/env python3
"""Hostinger MCP tool caller"""

import json
import subprocess
import yaml
import time
import sys

with open('/root/.hermes/config.yaml', 'r') as f:
    config = yaml.safe_load(f)
token = config['mcp_servers']['hostinger']['env']['HOSTINGER_API_TOKEN']

def call_tool(tool_name, arguments=None):
    if arguments is None:
        arguments = {}
    
    proc = subprocess.Popen(
        ['/root/.hermes/node/bin/hostinger-api-mcp', '--stdio'],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env={'HOSTINGER_API_TOKEN': token, 'PATH': '/usr/local/bin:/usr/bin:/bin'}
    )
    
    # Initialize
    init = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {'protocolVersion': '2024-11-05', 'capabilities': {}, 'clientInfo': {'name': 'hermes', 'version': '1.0.0'}}})
    proc.stdin.write(init + '\n')
    proc.stdin.flush()
    proc.stdout.readline()
    
    # Initialized notification
    notif = json.dumps({'jsonrpc': '2.0', 'method': 'notifications/initialized'})
    proc.stdin.write(notif + '\n')
    proc.stdin.flush()
    time.sleep(0.5)
    
    # Tool call
    tool_call = json.dumps({'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call', 'params': {'name': tool_name, 'arguments': arguments}})
    proc.stdin.write(tool_call + '\n')
    proc.stdin.flush()
    time.sleep(3)
    
    line = proc.stdout.readline()
    proc.terminate()
    
    data = json.loads(line)
    content = data.get('result', {}).get('content', [])
    if content:
        return json.loads(content[0].get('text', '{}'))
    return None

if __name__ == "__main__":
    tool = sys.argv[1] if len(sys.argv) > 1 else "domains_getDomainListV1"
    args = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
    result = call_tool(tool, args)
    print(json.dumps(result, indent=2))
