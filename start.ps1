# Скрипт запуска Dashboard
Write-Host "🚀 Запуск Discord Bot Dashboard..." -ForegroundColor Cyan

# Загружаем переменные окружения из .env файла (если существует)
if (Test-Path ".env") {
    Get-Content ".env" | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]*)=(.*)$') {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim()
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
    Write-Host "✅ Переменные окружения загружены из .env" -ForegroundColor Green
} else {
    Write-Host "⚠️  Файл .env не найден. Создайте его на основе env.example" -ForegroundColor Yellow
}

# Порт по умолчанию
if (-not $env:PORT) {
    $env:PORT = "3000"
}

Write-Host "✅ Переменные окружения установлены" -ForegroundColor Green
Write-Host "📊 Открывайте: http://localhost:3000" -ForegroundColor Yellow
Write-Host ""

# Запускаем сервер
node server.js

