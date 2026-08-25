param(
  [string]$SdkRoot = "$env:LOCALAPPDATA\Android\Sdk",
  [int]$ApiLevel = 36
)

$ErrorActionPreference = 'Stop'
$toolsRevision = '13114758'
$toolsUrl = "https://dl.google.com/android/repository/commandlinetools-win-${toolsRevision}_latest.zip"
$sdkManager = Join-Path $SdkRoot 'cmdline-tools\latest\bin\sdkmanager.bat'

if (-not (Get-Command java -ErrorAction SilentlyContinue)) {
  throw 'Java is required. Install Microsoft OpenJDK 21 and set JAVA_HOME.'
}

$javaHomes = @($env:JAVA_HOME)
$microsoftJavaRoot = Join-Path $env:ProgramFiles 'Microsoft'
if (Test-Path -LiteralPath $microsoftJavaRoot) {
  $javaHomes += Get-ChildItem -LiteralPath $microsoftJavaRoot -Directory -Filter 'jdk-21*' |
    Select-Object -ExpandProperty FullName
}
$hasJava21 = $false
foreach ($javaHome in $javaHomes) {
  $releaseFile = Join-Path $javaHome 'release'
  if ((Test-Path -LiteralPath $releaseFile) -and (Select-String -LiteralPath $releaseFile -Pattern 'JAVA_VERSION="21' -Quiet)) {
    $hasJava21 = $true
    break
  }
}
if (-not $hasJava21) {
  throw 'JDK 21 is required. Install it with: winget install Microsoft.OpenJDK.21'
}

if (-not (Test-Path -LiteralPath $sdkManager)) {
  $tempRoot = Join-Path $env:TEMP ("dsh-go-android-sdk-" + [Guid]::NewGuid().ToString('N'))
  $archive = Join-Path $tempRoot 'command-line-tools.zip'
  $expanded = Join-Path $tempRoot 'expanded'
  $latestRoot = Split-Path (Split-Path $sdkManager -Parent) -Parent
  New-Item -ItemType Directory -Path $expanded -Force | Out-Null
  New-Item -ItemType Directory -Path $latestRoot -Force | Out-Null

  Write-Host 'Downloading Android command-line tools...'
  Invoke-WebRequest -Uri $toolsUrl -OutFile $archive
  Expand-Archive -LiteralPath $archive -DestinationPath $expanded -Force
  Copy-Item -Path (Join-Path $expanded 'cmdline-tools\*') -Destination $latestRoot -Recurse -Force

  $resolvedTemp = (Resolve-Path -LiteralPath $tempRoot).Path
  $resolvedTempParent = (Resolve-Path -LiteralPath $env:TEMP).Path
  if ($resolvedTemp.StartsWith($resolvedTempParent, [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
  }
}

$env:ANDROID_HOME = $SdkRoot
$env:ANDROID_SDK_ROOT = $SdkRoot
[Environment]::SetEnvironmentVariable('ANDROID_HOME', $SdkRoot, 'User')
[Environment]::SetEnvironmentVariable('ANDROID_SDK_ROOT', $SdkRoot, 'User')

$answers = ((1..100 | ForEach-Object { 'y' }) -join "`n") + "`n"
$answers | & $sdkManager "--sdk_root=$SdkRoot" --licenses | Out-Host
& $sdkManager "--sdk_root=$SdkRoot" 'platform-tools' "platforms;android-$ApiLevel" "build-tools;$ApiLevel.0.0"

$requiredFiles = @(
  (Join-Path $SdkRoot 'platform-tools\adb.exe'),
  (Join-Path $SdkRoot "platforms\android-$ApiLevel\android.jar"),
  (Join-Path $SdkRoot "build-tools\$ApiLevel.0.0\aapt2.exe")
)
foreach ($requiredFile in $requiredFiles) {
  if (-not (Test-Path -LiteralPath $requiredFile)) {
    throw "Android SDK installation is incomplete: $requiredFile"
  }
}

Write-Host "Android SDK ready at $SdkRoot"
