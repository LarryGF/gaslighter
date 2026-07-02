$Mode = if ($env:GASLIGHTER_MODE) { $env:GASLIGHTER_MODE.ToLowerInvariant() } else { "full" }
if ($Mode -eq "off") { exit 0 }

$Esc = [char]27
if ($Mode -eq "full") {
    [Console]::Write("${Esc}[38;5;167m[GASLIGHTER]${Esc}[0m")
} else {
    $Suffix = $Mode.ToUpperInvariant()
    [Console]::Write("${Esc}[38;5;167m[GASLIGHTER:$Suffix]${Esc}[0m")
}
