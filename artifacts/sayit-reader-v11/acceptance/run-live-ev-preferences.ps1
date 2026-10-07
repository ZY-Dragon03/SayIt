$ErrorActionPreference = 'Stop'

$candidateRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..')).Path
$dataDirectory = Join-Path $env:TEMP 'sayit-reader-v11-a33-ev-20261007T045311Z'
$fetchReceipt = Join-Path $PSScriptRoot 'pat-v11-06-ev-fetch-a33e7ff1-20261007T045311Z.jsonl'
$env:SAYIT_ACCEPTANCE_READER_DATA_DIR = $dataDirectory
$env:SAYIT_ACCEPTANCE_FETCH_TRACE_PATH = $fetchReceipt

if (Test-Path -LiteralPath $dataDirectory) {
    throw 'The isolated Reader data path already exists; refusing to reuse it.'
}
if (Test-Path -LiteralPath $fetchReceipt) {
    throw 'The candidate-bound fetch receipt already exists; refusing to overwrite it.'
}

$vitest = Join-Path $candidateRoot 'node_modules\.bin\vitest.cmd'
$vitestArgs = @(
    'run'
    '--config'
    'artifacts/sayit-reader-v11/acceptance/vitest.acceptance.config.ts'
    'artifacts/sayit-reader-v11/acceptance/pat-v11-06-seed-ev-preferences.acceptance.ts'
)
& $vitest @vitestArgs
if ($LASTEXITCODE -ne 0) {
    throw "The isolated preference seed failed with exit code $LASTEXITCODE."
}

$vite = Join-Path $candidateRoot 'node_modules\.bin\vite.cmd'
$viteArgs = @(
    '--config'
    'artifacts/sayit-reader-v11/acceptance/vite.acceptance-live.config.ts'
)
& $vite @viteArgs
if ($LASTEXITCODE -ne 0) {
    throw "The candidate Vite server exited with code $LASTEXITCODE."
}
