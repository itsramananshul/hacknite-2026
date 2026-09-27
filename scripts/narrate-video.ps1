param([string]$Directory)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Speech
$segments=Get-Content -LiteralPath (Join-Path $Directory 'narration.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$speaker=New-Object System.Speech.Synthesis.SpeechSynthesizer
$speaker.Rate=0
for($index=0;$index -lt $segments.Count;$index++) {
  $speaker.SetOutputToWaveFile((Join-Path $Directory "voice-$index.wav"))
  $speaker.Speak([string]$segments[$index])
  $speaker.SetOutputToNull()
}
$speaker.Dispose()
