# SeamForge

Desktop-приложение для создания бесшовных аудиопетель. Файл декодируется и обрабатывается локально: приложение ищет похожие участки сигнала у границ, выбирает точки рядом с zero crossing и запекает constant-gain crossfade без подъёма громкости в экспортируемый WAV.

## Возможности

- импорт WAV, MP3, FLAC, M4A, OGG и других форматов, поддерживаемых Chromium;
- предварительная обрезка файла с перетаскиваемой областью и прослушиванием выбранного фрагмента;
- интерактивная форма волны на wavesurfer.js;
- автоматический поиск лучшего стыка или ручная настройка начала и конца;
- Fast Pro поиск: beat-synced признаки, определение 3/4 или 4/4 такта и привязка к одинаковой позиции в такте;
- опциональный AI Studio режим: локальный BS-RoFormer отделяет вокал, после чего полный перебор штрафует стыки внутри слов;
- окно настроек с постоянным выбором CPU или NVIDIA CUDA GPU для ИИ-обработки;
- recurrence-матрица с усилением диагоналей повторяющихся музыкальных фраз;
- финальная вокал-безопасная микроподгонка в пределах ±20 мс: обе границы сдвигаются вместе, сохраняя точную длину фразы;
- видимый playhead обработанного loop с перемоткой по waveform и отдельному ползунку;
- до пяти кандидатов с составным индексом уверенности для прослушивания;
- непрерывное прослушивание уже обработанного результата;
- регулируемый crossfade от 5 мс;
- локальный экспорт 16-bit PCM WAV.

## Запуск

```powershell
npm install
npm run dev
```

## Проверка и сборка

```powershell
npm run check
npm run dist
```

Готовый Windows-инсталлятор появится в `release/`.

Если Windows или антивирус блокирует атомарную распаковку NSIS-сборщика, создайте переносимую версию без установки:

```powershell
npm run dist:portable
```

Запускаемый файл появится в `release/SeamForge-portable/SeamForge.exe`.

## ИИ-режим

ИИ отключён по умолчанию и не влияет на Fast Pro. После включения галочки первый анализ загружает `uv`, создаёт собственное изолированное окружение Python 3.12 в данных приложения, устанавливает `audio-separator[cpu]` и модель BS-RoFormer. Это выполняется один раз, может занять несколько минут и требует подключения к интернету. Последующие анализы используют локальный кеш; аудио никуда не отправляется. Системный Python устанавливать не нужно.

## Технологии и источники паттернов

- [electron/electron](https://github.com/electron/electron) — desktop shell;
- [vitejs/vite](https://github.com/vitejs/vite) — сборка renderer-процесса;
- [facebook/react](https://github.com/facebook/react) — интерфейс;
- [katspaugh/wavesurfer.js](https://github.com/katspaugh/wavesurfer.js) — форма волны и навигация по аудио;
- [arkrow/PyMusicLooper](https://github.com/arkrow/PyMusicLooper) — архитектура beat/chroma-поиска и ранжирование нескольких loop points;
- [meyda/meyda](https://github.com/meyda/meyda) — локальное извлечение chroma, RMS и спектральных признаков;
- [nomadkaraoke/python-audio-separator](https://github.com/nomadkaraoke/python-audio-separator) — локальное разделение вокала моделью BS-RoFormer в AI Studio;
- [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds) — локальная LGPL-сборка FFmpeg для AI-пайплайна;
- [shadcn-ui/ui](https://github.com/shadcn-ui/ui) — ориентир для доступных, composable UI-паттернов.

Код этих проектов не копировался; использованы их публичные API и архитектурные паттерны.
