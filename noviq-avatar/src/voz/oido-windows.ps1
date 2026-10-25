# Noviq Avatar - oido con el reconocedor de voz de Windows (System.Speech), sin internet ni clave.
# Lo usa el avatar SOLO si eliges «Windows» en sus Ajustes -> Oido. Lee un WAV y escribe el texto.
param([string]$Wav, [string]$Idioma = 'es')
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Speech
  $r = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | Where-Object { $_.Culture.TwoLetterISOLanguageName -eq $Idioma } | Select-Object -First 1
  if (-not $r) { [Console]::Out.Write('ERR:sin reconocedor de voz de Windows para ese idioma'); exit }
  $e = New-Object System.Speech.Recognition.SpeechRecognitionEngine($r)
  $e.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  $e.SetInputToWaveFile($Wav)
  $res = $e.Recognize()
  $t = if ($res) { $res.Text } else { '' }
  $e.Dispose()
  [Console]::Out.Write('OK:' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($t)))
} catch { [Console]::Out.Write('ERR:' + $_.Exception.Message) }
