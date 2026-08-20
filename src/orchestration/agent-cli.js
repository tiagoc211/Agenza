const fs = require('node:fs');
const path = require('node:path');

const AGENT_CLI_DIRECTORY = 'orchestration-tools';

const POWERSHELL_SOURCE = String.raw`param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('whoami', 'list', 'create', 'remove', 'send', 'inbox')]
  [string]$Command,
  [Parameter(Position = 1)]
  [string]$Target,
  [Parameter(Position = 2, ValueFromRemainingArguments = $true)]
  [string[]]$Text
)

$ErrorActionPreference = 'Stop'
$baseUrl = $env:AGENZA_CONTROL_URL
$token = $env:AGENZA_AGENT_TOKEN

if ([string]::IsNullOrWhiteSpace($baseUrl) -or [string]::IsNullOrWhiteSpace($token)) {
  throw 'This command is available only inside an Agenza-managed Codex terminal.'
}

$headers = @{ Authorization = "Bearer $token" }

function Invoke-AgenzaRequest {
  param(
    [string]$Method,
    [string]$Path,
    [object]$Body = $null
  )

  $parameters = @{
    Headers = $headers
    Method = $Method
    Uri = "$baseUrl$Path"
  }

  if ($null -ne $Body) {
    $parameters.ContentType = 'application/json'
    $parameters.Body = ConvertTo-Json $Body -Compress
  }

  Invoke-RestMethod @parameters
}

$result = switch ($Command) {
  'whoami' { Invoke-AgenzaRequest -Method Get -Path '/v1/whoami' }
  'list' { Invoke-AgenzaRequest -Method Get -Path '/v1/agents' }
  'create' { Invoke-AgenzaRequest -Method Post -Path '/v1/agents' -Body @{} }
  'inbox' { Invoke-AgenzaRequest -Method Get -Path '/v1/inbox' }
  'remove' {
    if ([string]::IsNullOrWhiteSpace($Target)) {
      throw 'Usage: agenza-agent remove <terminal-id>'
    }
    Invoke-AgenzaRequest -Method Post -Path '/v1/remove' -Body @{ targetId = $Target }
  }
  'send' {
    $message = @($Text) -join ' '
    if ([string]::IsNullOrWhiteSpace($Target) -or [string]::IsNullOrWhiteSpace($message)) {
      throw 'Usage: agenza-agent send <terminal-id|all> <message>'
    }
    Invoke-AgenzaRequest -Method Post -Path '/v1/messages' -Body @{
      message = $message
      targetId = $Target
    }
  }
}

$result | ConvertTo-Json -Depth 8
`;

const CMD_SOURCE = `@echo off\r\npowershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0agenza-agent.ps1" %*\r\n`;

const installAgentCli = ({ directory, fsModule = fs, pathModule = path } = {}) => {
  if (typeof directory !== 'string' || !pathModule.isAbsolute(directory)) {
    throw new TypeError('The Agenza agent CLI requires an absolute application-data directory.');
  }

  const toolDirectory = pathModule.join(directory, AGENT_CLI_DIRECTORY);
  fsModule.mkdirSync(toolDirectory, { recursive: true });
  fsModule.writeFileSync(pathModule.join(toolDirectory, 'agenza-agent.ps1'), POWERSHELL_SOURCE, {
    encoding: 'utf8',
    mode: 0o600,
  });
  fsModule.writeFileSync(pathModule.join(toolDirectory, 'agenza-agent.cmd'), CMD_SOURCE, {
    encoding: 'utf8',
    mode: 0o700,
  });
  return toolDirectory;
};

module.exports = {
  AGENT_CLI_DIRECTORY,
  CMD_SOURCE,
  POWERSHELL_SOURCE,
  installAgentCli,
};
