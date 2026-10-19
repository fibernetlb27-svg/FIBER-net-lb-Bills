param([switch]$SkipChecks, [string]$TemporaryHttpEndpoint = '')
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$appRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$sdkParent = (Resolve-Path (Join-Path $appRoot '../mobile-sdk')).Path
$flutterCommand = Join-Path $sdkParent 'flutter/bin/flutter.bat'
$androidSdk = Join-Path $sdkParent 'android'
$jdkDirectory = 'C:\Program Files\Android\openjdk\jdk-21.0.8'
if (-not (Test-Path -LiteralPath (Join-Path $androidSdk 'platforms/android-36/android.jar'))) { throw 'Android API 36 is not installed. Complete the approved SDK setup first.' }
if (-not (Test-Path -LiteralPath (Join-Path $jdkDirectory 'bin/java.exe'))) { throw 'Configure an installed JDK 17 or newer before building.' }
$env:JAVA_HOME = $jdkDirectory
$env:ANDROID_HOME = $androidSdk
$env:ANDROID_SDK_ROOT = $androidSdk
$env:ANDROID_USER_HOME = Join-Path $androidSdk 'user'
$env:GRADLE_USER_HOME = Join-Path $sdkParent 'gradle-cache'
$env:CI = 'true'
$env:FLUTTER_SUPPRESS_ANALYTICS = 'true'
$buildOptions = @('build', 'apk', '--debug', '--target-platform', 'android-arm64')
if ($TemporaryHttpEndpoint) {
  $temporaryEndpointMatch = [regex]::Match($TemporaryHttpEndpoint, '^http://((?:(?:0|[1-9][0-9]{0,2})\.){3}(?:0|[1-9][0-9]{0,2})):([1-9][0-9]{0,4})/?$')
  if (-not $temporaryEndpointMatch.Success -or [int]$temporaryEndpointMatch.Groups[2].Value -gt 65535 -or [int]$temporaryEndpointMatch.Groups[2].Value -eq 80) {
    throw 'Temporary testing requires canonical http://IPv4:port with an explicit non-default port, no extra path or address shorthand.'
  }
  $temporaryServer = [Uri]$TemporaryHttpEndpoint
  $temporaryAddress = $null
  if ($temporaryServer.Scheme -ne 'http' -or $temporaryServer.UserInfo -or $temporaryServer.Query -or $temporaryServer.Fragment -or $temporaryServer.AbsolutePath -ne '/' -or
      -not [System.Net.IPAddress]::TryParse($temporaryServer.Host, [ref]$temporaryAddress) -or $temporaryAddress.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) {
    throw 'Temporary testing requires a plain HTTP base URL with one IPv4 address, no credentials, query or extra path.'
  }
  $env:ORG_GRADLE_PROJECT_temporaryHttpHost = $temporaryServer.Host
  # Pass explicitly as well: a previously started Gradle daemon must not retain
  # an older/unset environment-derived project property.
  $buildOptions += "--android-project-arg=temporaryHttpHost=$($temporaryServer.Host)"
  $buildOptions += "--dart-define=TEMPORARY_HTTP_ENDPOINT=$($temporaryServer.GetLeftPart([System.UriPartial]::Authority))"
} else {
  Remove-Item Env:ORG_GRADLE_PROJECT_temporaryHttpHost -ErrorAction SilentlyContinue
  $buildOptions += '--android-project-arg=temporaryHttpHost='
}
Set-Location -LiteralPath $appRoot
if (-not $SkipChecks) {
  & $flutterCommand analyze
  if ($LASTEXITCODE -ne 0) { throw 'Mobile analysis failed.' }
  & $flutterCommand test
  if ($LASTEXITCODE -ne 0) { throw 'Mobile regression tests failed.' }
}
& $flutterCommand @buildOptions
if ($LASTEXITCODE -ne 0) { throw 'Android pilot APK build failed.' }
Write-Output 'ARM64 Android pilot APK built. This is a debug-signed test app, not a store release.'
