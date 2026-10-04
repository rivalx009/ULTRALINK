# ULTRALINK desktop — streams Windows Location fixes as JSON lines (lat, lon, accuracy m, altitude m, speed m/s, heading deg, ts ms)
# Needs Windows Settings > Privacy & security > Location = ON (and "Let desktop apps access your location").
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Device
  $w = New-Object System.Device.Location.GeoCoordinateWatcher([System.Device.Location.GeoPositionAccuracy]::High)
  $w.MovementThreshold = 0
  if (-not $w.TryStart($false, [TimeSpan]::FromSeconds(8))) { '{"err":"location service did not start"}'; exit 1 }
  if ($w.Permission -eq 'Denied') { '{"err":"location permission denied in Windows settings"}'; exit 1 }
  $inv = [Globalization.CultureInfo]::InvariantCulture
  $last = ''
  $idle = 0
  while ($true) {
    $p = $w.Position
    if ($p -and -not $p.Location.IsUnknown) {
      $l = $p.Location
      $f = { param($v) if ([double]::IsNaN($v)) { 'null' } else { $v.ToString('R', $inv) } }
      $ts = $p.Timestamp.ToUnixTimeMilliseconds()
      $line = '{"lat":' + (& $f $l.Latitude) + ',"lon":' + (& $f $l.Longitude) + ',"acc":' + (& $f $l.HorizontalAccuracy) + ',"alt":' + (& $f $l.Altitude) + ',"spd":' + (& $f $l.Speed) + ',"hdg":' + (& $f $l.Course) + ',"ts":' + $ts + '}'
      if ($line -ne $last -or $idle -ge 5) { [Console]::Out.WriteLine($line); [Console]::Out.Flush(); $last = $line; $idle = 0 } else { $idle++ }
    } elseif ($w.Status -eq 'Disabled') { '{"err":"Windows location is turned off"}'; exit 1 }
    Start-Sleep -Milliseconds 1000
  }
} catch { '{"err":"' + ($_.Exception.Message -replace '"', "'") + '"}'; exit 1 }
