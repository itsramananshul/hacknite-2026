param([string]$Directory)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Speech
$payload=Get-Content -LiteralPath (Join-Path $Directory 'input.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$speaker=New-Object System.Speech.Synthesis.SpeechSynthesizer
$speaker.Rate=0
$segments=@($payload.scene.problemText)+@($payload.scene.steps | ForEach-Object {$_.narration})+@('The calculated answers are. '+(($payload.scene.answers | ForEach-Object -Begin {$index=0} -Process { $value=[Math]::Round($payload.answers[$index],3); $index++; "$($_.question): $value $($_.unit)." }) -join ' '))
for($index=0;$index -lt $segments.Count;$index++) {
  $speaker.SetOutputToWaveFile((Join-Path $Directory "voice-$index.wav"))
  $speaker.Speak([string]$segments[$index])
  $speaker.SetOutputToNull()
}
$speaker.Dispose()
