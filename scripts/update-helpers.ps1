# Pure process matching is also used by the updater's non-destructive tests.
function Test-MakAppProcess($Process) {
  return $Process.Name -in @('mrmak-workspace.exe', 'mrmak-desktop.exe')
}
function Test-MakAncestor($Processes, [int]$CurrentId) {
  $taskSeen = @{}
  while ($CurrentId -gt 0 -and -not $taskSeen.ContainsKey($CurrentId)) {
    $taskSeen[$CurrentId] = $true
    $taskParent = $Processes | Where-Object { $_.ProcessId -eq $CurrentId } | Select-Object -First 1
    if (-not $taskParent) { return $false }
    if (Test-MakAppProcess $taskParent) { return $true }
    $CurrentId = [int]$taskParent.ParentProcessId
  }
  return $false
}
function Get-MakUpdateProcesses($Processes, [string[]]$InstallDirectories) {
  foreach ($taskProcess in $Processes) {
    if (Test-MakAppProcess $taskProcess) { $taskProcess; continue }
    if ($taskProcess.Name -ne 'node.exe' -or -not $taskProcess.ExecutablePath) { continue }
    foreach ($taskDirectory in $InstallDirectories) {
      if ($taskDirectory -and $taskProcess.ExecutablePath.StartsWith($taskDirectory.TrimEnd('\') + '\runtime\', [StringComparison]::OrdinalIgnoreCase)) { $taskProcess; break }
    }
  }
}
function Get-MakInstallDirectory {
  foreach ($taskRegistry in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*')) {
    $taskInstallEntry = Get-ItemProperty -Path $taskRegistry -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -eq 'Mr. Mak Workspace' -and $_.InstallLocation } | Select-Object -First 1
    # The NSIS installer records InstallLocation wrapped in quotes.
    if ($taskInstallEntry) { return [IO.Path]::GetFullPath($taskInstallEntry.InstallLocation.Trim().Trim('"')) }
  }
  return (Join-Path $env:LOCALAPPDATA 'Mr. Mak Workspace')
}
