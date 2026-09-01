# publish-public.ps1 — 私有 → 公共仓库 快照发布（安全检查 + 干净树同步，不带私有历史）
#
# ⚠️ 重要：私有仓库历史含敏感信息（签名密钥/IP/万能码），公共仓库必须是独立历史。
# 本脚本把「当前工作树的干净快照」复制到公共仓库目录并独立提交/推送，绝不复制历史。
#
# 用法（一次性准备）：
#   git init <公共仓库目录> && cd <公共仓库目录>
#   git remote add origin https://github.com/<你>/<公共仓库>.git
#   （可选）git -C <公共仓库目录> branch -M main
# 每次发布：
#   scripts/publish-public.ps1 -PublicDir <公共仓库目录>
#   scripts/publish-public.ps1 -PublicDir <公共仓库目录> -DryRun   # 只检查不同步
param(
  [Parameter(Mandatory=$true)][string]$PublicDir,   # 公共仓库本地路径（已 git init + 配置 remote）
  [string]$Branch = "master",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Write-Host "== 1/4 安全检查（当前追踪文件中的敏感内容） ==" -ForegroundColor Cyan
# 通用敏感模式。注意：本文件本身会进公共仓库，所以这里只能写「形状」，
# 绝不能写任何真实 IP、密钥前缀或主机别名——那等于把答案印在检查表上。
$patterns = @(
  '\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b',                      # 任何裸 IPv4（占位符见下方白名单）
  'BEGIN (RSA|PRIVATE|OPENSSH|EC) PRIVATE KEY',              # 私钥
  'ssh-(rsa|ed25519) AAAA',                                  # 公钥/授权密钥
  'MOBILE_SIGNING_SECRET\s*=\s*[A-Za-z0-9_+/=-]{16,}',       # 真实签名密钥赋值
  'MOBILE_BIND_CODE\s*=\s*[A-Za-z0-9_-]{8,}',                # 真实万能码赋值
  '(?i)(api[_-]?key|secret|passwd|password|token)["\s:=]{1,4}[A-Za-z0-9_+/=-]{16,}'  # 硬编码凭据
)

# 允许出现的占位/回环/内网地址，命中这些不算违规。
$ipAllow = @('127.0.0.1', '0.0.0.0', '1.2.3.4', '255.255.255.255', '8.8.8.8')

# 可选：把你自己环境的真实敏感串（VPS IP、SSH 别名、旧密钥前缀等）
# 每行一个正则写进 scripts/.publish-secrets.local —— 该文件已被 .gitignore 排除，不会进仓库。
$localRuleFile = Join-Path $PSScriptRoot '.publish-secrets.local'
if (Test-Path $localRuleFile) {
  $patterns += (Get-Content $localRuleFile | Where-Object { $_.Trim() -and -not $_.StartsWith('#') })
}
$violations = @()
$tracked = git ls-files 2>$null
foreach ($f in $tracked) {
  if (-not (Test-Path $f)) { continue }
  # 锁文件里全是 registry 地址与哈希，逐条扫会淹没真实告警
  if ($f -like '*package-lock.json') { continue }
  foreach ($p in $patterns) {
    $m = Select-String -Path $f -Pattern $p -AllMatches -ErrorAction SilentlyContinue
    if (-not $m) { continue }
    foreach ($hit in $m) {
      foreach ($match in $hit.Matches) {
        $value = $match.Value
        # IPv4 白名单：回环、占位、内网段不算违规
        if ($value -match '^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$') {
          if ($ipAllow -contains $value) { continue }
          if ($value -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)') { continue }
        }
        $violations += ("{0}:{1} 命中 [{2}] -> {3}" -f $f, $hit.LineNumber, $p, $value)
      }
    }
  }
}
if ($violations.Count -gt 0) {
  Write-Host "发现敏感内容，已阻止发布：" -ForegroundColor Red
  $violations | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
  exit 1
}
Write-Host "安全检查通过 ✓" -ForegroundColor Green

Write-Host "== 2/4 确认敏感目录未被跟踪 ==" -ForegroundColor Cyan
foreach ($d in @('evidence/', 'build-tools/', 'server/.secret', 'server/tokens.json', 'dist-apk/')) {
  $in = git ls-files $d 2>$null
  if ($in) { Write-Host "  !! 敏感目录已被跟踪: $d" -ForegroundColor Red; exit 1 }
}
Write-Host "目录检查通过 ✓" -ForegroundColor Green

if ($DryRun) { Write-Host "== 3/4 DryRun：跳过同步 ==" -ForegroundColor Yellow; exit 0 }

Write-Host "== 3/4 快照同步 → $PublicDir ==" -ForegroundColor Cyan
if (-not (Test-Path (Join-Path $PublicDir '.git'))) {
  Write-Host "公共仓库目录无效（无 .git）：请先 git init $PublicDir 并配置 remote" -ForegroundColor Red
  exit 1
}
$exclude = @(
  '.git','evidence','build-tools','node_modules',
  'web\dist','android\app\build','android\.gradle','android\build',
  'android\app\src\main\assets','dist-apk',
  'server\.secret','server\tokens.json'
)
robocopy $root $PublicDir /E /XD $exclude /XF *.log *.p12 *.jks *.keystore /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -ge 8) { Write-Host "robocopy 失败（exit $LASTEXITCODE）" -ForegroundColor Red; exit 1 }

Write-Host "== 4/4 公共仓库独立提交 + 推送 ==" -ForegroundColor Cyan
git -C $PublicDir add -A
git -C $PublicDir -c user.name="dsh-mobile" -c user.email="dsh-mobile@localhost" commit -m "sync: 快照 $(Get-Date -Format 'yyyy-MM-dd HH:mm')" 2>&1 | Select-Object -Last 3
if ($LASTEXITCODE -ne 0) { Write-Host "公共仓库提交失败（可能无改动或 git 配置缺失）" -ForegroundColor Yellow }
git -C $PublicDir push origin $Branch 2>&1 | Select-Object -Last 5
if ($LASTEXITCODE -ne 0) { Write-Host "推送失败：请检查 remote：git -C $PublicDir remote add origin <公共仓库URL>" -ForegroundColor Red; exit 1 }
Write-Host "发布完成 ✓（公共仓库已更新为当前干净快照）" -ForegroundColor Green
