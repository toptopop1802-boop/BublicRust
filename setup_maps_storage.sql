-- Создание таблицы для хранения метаданных карт
CREATE TABLE IF NOT EXISTS maps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    original_name TEXT NOT NULL,
    storage_path TEXT NOT NULL UNIQUE,
    file_size BIGINT NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Создание индекса для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_maps_uploaded_at ON maps(uploaded_at DESC);

-- Комментарии к таблице
COMMENT ON TABLE maps IS 'Таблица для хранения метаданных загруженных карт (.map файлов)';
COMMENT ON COLUMN maps.id IS 'Уникальный идентификатор карты';
COMMENT ON COLUMN maps.original_name IS 'Оригинальное имя файла при загрузке';
COMMENT ON COLUMN maps.storage_path IS 'Путь к файлу в Supabase Storage (bucket: maps)';
COMMENT ON COLUMN maps.file_size IS 'Размер файла в байтах';
COMMENT ON COLUMN maps.uploaded_at IS 'Дата и время загрузки';

-- Создание Storage Bucket в Supabase (выполнить вручную через Supabase Dashboard или API)
-- Или использовать следующий скрипт через Supabase CLI:
-- supabase storage create maps --public false

