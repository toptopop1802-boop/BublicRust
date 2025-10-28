# Скрипт запуска Dashboard
Write-Host "🚀 Запуск Discord Bot Dashboard..." -ForegroundColor Cyan

# Устанавливаем переменные окружения
$env:SUPABASE_URL = "https://svlgzmgkodwcufypyeec.supabase.co"
$env:SUPABASE_KEY = ""
$env:DISCORD_BOT_TOKEN = ""
$env:PORT = "3000"

Write-Host "✅ Переменные окружения установлены" -ForegroundColor Green
Write-Host "📊 Открывайте: http://localhost:3000" -ForegroundColor Yellow
Write-Host ""

# Запускаем сервер
node server.js

