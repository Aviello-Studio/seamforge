import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type Locale = 'en' | 'ru' | 'zh' | 'ja' | 'es' | 'de'

export interface LocaleOption {
  code: Locale
  label: string
  nativeName: string
}

export const LOCALES: readonly LocaleOption[] = [
  { code: 'en', label: 'EN', nativeName: 'English' },
  { code: 'ru', label: 'RU', nativeName: 'Русский' },
  { code: 'zh', label: '中文', nativeName: '简体中文' },
  { code: 'ja', label: '日本語', nativeName: '日本語' },
  { code: 'es', label: 'ES', nativeName: 'Español' },
  { code: 'de', label: 'DE', nativeName: 'Deutsch' },
] as const

export interface TranslationMap {
  // TitleBar
  titlebarClear: string
  titlebarClearTitle: string
  titlebarOpen: string
  titlebarOpenTitle: string
  titlebarLangLabel: string
  titlebarWindowControls: string
  titlebarMinimize: string
  titlebarMaximize: string
  titlebarMaximizeAria: string
  titlebarRestore: string
  titlebarRestoreAria: string
  titlebarClose: string

  // EmptyDropzone
  emptyRegionAria: string
  emptyLoadingTitle: string
  emptyDragTitle: string
  emptyDefaultTitle: string
  emptyLoadingBtn: string
  emptyChooseBtn: string
  emptySpec1Title: string
  emptySpec1Desc: string
  emptySpec2Title: string
  emptySpec2Desc: string
  emptySpec3Title: string
  emptySpec3Desc: string

  // WaveformCanvas
  waveformRegionAria: string
  waveformZoomGroupAria: string
  waveformZoomOut: string
  waveformZoomCurrentAria: string
  waveformZoomIn: string
  waveformFitTrack: string
  waveformFitTrackTitle: string
  waveformToSeam: string
  waveformToSeamTitle: string
  waveformBeats: string
  waveformBeatsDisabledTitle: string
  waveformBeatsToggleTitle: string
  waveformPanbarAria: string

  // SeamInspector
  seamRegionAria: string
  seamTitle: string
  seamLegendAria: string
  seamLegendTail: string
  seamLegendHead: string
  seamLegendBlended: string
  seamMetricPhase: string
  seamMetricSmoothness: string
  seamScopeAria: string
  seamStart: string
  seamEnd: string
  seamNudgeStartAria: string
  seamNudgeEndAria: string
  seamSnapTitle: string
  seamSnapStartAria: string
  seamSnapEndAria: string
  seamCrossfade: string
  seamCurve: string
  seamCurveGroupAria: string
  seamCurveConstantGainTitle: string
  seamCurveEqualPowerTitle: string
  unitMs: string

  // CandidateSidebar
  sidebarRegionAria: string
  sidebarTitle: string
  sidebarAnalyzingFallback: string
  sidebarCancel: string
  sidebarFindSeams: string
  sidebarEmptyAnalyzing: string
  sidebarEmptyIdle: string
  sidebarDiagAria: string
  sidebarDiagHarmony: string
  sidebarDiagPhrase: string
  sidebarDiagRhythm: string
  sidebarDiagPhase: string

  // TransportBar
  transportRegionAria: string
  transportPlay: string
  transportPause: string
  transportPlayTitle: string
  transportAudioUnavailable: string
  transportSeam: string
  transportSeamTitle: string
  transportLoopPositionAria: string
  transportPlaybackPositionAria: string
  transportVolumeRegionAria: string
  transportVolumeSliderAria: string
  transportVolumeSliderTitle: string
  transportMuteAria: string
  transportMuteTitle: string
  transportUnmuteAria: string
  transportUnmuteTitle: string
  transportWavFormatAria: string
  transportWav16: string
  transportWav24: string
  transportWav32: string
  transportExport: string
  transportExporting: string
  transportExportTitle: string

  // TrimModal
  trimTitle: string
  trimCloseAria: string
  trimCloseTitle: string
  trimStartLabel: string
  trimEndLabel: string
  trimDurationLabel: string
  trimVolumeAria: string
  trimPlay: string
  trimStop: string
  trimUseFull: string
  trimApply: string

  // ConfirmDialog
  confirmCancelDefault: string
  confirmCloseAria: string
  confirmClearTitle: string
  confirmClearDesc: string
  confirmClearAction: string
  confirmReplaceTitle: string
  confirmReplaceDesc: string
  confirmReplaceDetail: string
  confirmReplaceAction: string

  // Drop overlay
  dropOverlayText: string

  // Native dialogs
  dialogOpenTitle: string
  dialogFilterAllMedia: string
  dialogFilterAudio: string
  dialogFilterVideo: string
  dialogSaveTitle: string
  dialogFilterWav: string

  // Status & errors
  statusReady: string
  statusExtractingVideo: string
  statusDecodingAudio: string
  statusOpenedHint: string
  statusTrimCancelled: string
  statusPreparingAnalysis: string
  statusAnalyzingAudio: string
  statusNoSeamsFound: string
  statusAnalysisCancelled: string
  statusSnappedZeroCrossing: string
  statusExportCancelled: string
  statusExportWriting: string
  statusExportSaved: string

  errorUnsupportedFormat: string
  errorDecodeFailed: string
  errorLoadPrefix: string
  errorOpenDialogPrefix: string
  errorSeamRecalcPrefix: string
  errorTrimPrefix: string
  errorAnalysisPrefix: string
  errorSnapPrefix: string
  errorPlaybackPrefix: string
  errorAuditionPrefix: string
  errorExportPrefix: string

  // Backend DSP analysis stages
  stagePrepare: string
  stageStft: string
  stageTempo: string
  stageHarmony: string
  stageSimilarity: string
  stageSearch: string
  stagePhase: string
  stageSelect: string
  stageDone: string
}

export const TRANSLATIONS: Record<Locale, TranslationMap> = {
  en: {
    titlebarClear: 'Clear',
    titlebarClearTitle: 'Clear project and load a new file',
    titlebarOpen: 'Open',
    titlebarOpenTitle: 'Open audio or video file (Ctrl+O)',
    titlebarLangLabel: 'Interface language',
    titlebarWindowControls: 'Window controls',
    titlebarMinimize: 'Minimize',
    titlebarMaximize: 'Maximize',
    titlebarMaximizeAria: 'Maximize window',
    titlebarRestore: 'Restore',
    titlebarRestoreAria: 'Restore window',
    titlebarClose: 'Close',

    emptyRegionAria: 'Load audio file',
    emptyLoadingTitle: 'Extracting and decoding audio…',
    emptyDragTitle: 'Drop file to open',
    emptyDefaultTitle: 'Open or drop an audio or video file',
    emptyLoadingBtn: 'Loading…',
    emptyChooseBtn: 'Choose file',
    emptySpec1Title: 'Original sample rate, no resampling',
    emptySpec1Desc: 'Preserves the native sample grid',
    emptySpec2Title: 'Multi-threaded Rust analysis',
    emptySpec2Desc: 'Matches harmony, rhythm, and phase',
    emptySpec3Title: '16, 24 & 32-bit float WAV export',
    emptySpec3Desc: 'Click-free precision loop splicing',

    waveformRegionAria: 'Waveform and loop boundaries',
    waveformZoomGroupAria: 'Waveform zoom',
    waveformZoomOut: 'Zoom out',
    waveformZoomCurrentAria: 'Current zoom',
    waveformZoomIn: 'Zoom in',
    waveformFitTrack: 'Fit track',
    waveformFitTrackTitle: 'Show entire track',
    waveformToSeam: 'To seam',
    waveformToSeamTitle: 'Zoom to seam region',
    waveformBeats: 'Beats',
    waveformBeatsDisabledTitle: 'Beat grid appears after analysis',
    waveformBeatsToggleTitle: 'Show or hide beat grid',
    waveformPanbarAria: 'Waveform navigation',

    seamRegionAria: 'Seam inspector',
    seamTitle: 'Seam',
    seamLegendAria: 'Oscilloscope legend',
    seamLegendTail: 'Tail',
    seamLegendHead: 'Head',
    seamLegendBlended: 'Blend',
    seamMetricPhase: 'Phase',
    seamMetricSmoothness: 'Smoothness',
    seamScopeAria: 'Oscilloscope of loop tail and head alignment',
    seamStart: 'Start',
    seamEnd: 'End',
    seamNudgeStartAria: 'Fine-adjust start',
    seamNudgeEndAria: 'Fine-adjust end',
    seamSnapTitle: 'Snap to zero crossing',
    seamSnapStartAria: 'Snap start to zero crossing',
    seamSnapEndAria: 'Snap end to zero crossing',
    seamCrossfade: 'Crossfade',
    seamCurve: 'Curve',
    seamCurveGroupAria: 'Crossfade curve',
    seamCurveConstantGainTitle: 'Best for phase-aligned loops',
    seamCurveEqualPowerTitle: 'Best for pads and ambient textures',
    unitMs: 'ms',

    sidebarRegionAria: 'Seam candidates',
    sidebarTitle: 'Seams',
    sidebarAnalyzingFallback: 'Analyzing…',
    sidebarCancel: 'Cancel',
    sidebarFindSeams: 'Find seams',
    sidebarEmptyAnalyzing: 'Searching for musical loop points…',
    sidebarEmptyIdle: 'Click "Find seams" to auto-detect loop points.',
    sidebarDiagAria: 'Seam diagnostics',
    sidebarDiagHarmony: 'Harmony',
    sidebarDiagPhrase: 'Phrase',
    sidebarDiagRhythm: 'Rhythm',
    sidebarDiagPhase: 'Phase',

    transportRegionAria: 'Transport and export',
    transportPlay: 'Play',
    transportPause: 'Pause',
    transportPlayTitle: 'Play / pause (Space)',
    transportAudioUnavailable: 'Audio output device unavailable',
    transportSeam: 'Seam',
    transportSeamTitle: 'Audition transition 2.5 seconds before seam (S)',
    transportLoopPositionAria: 'Position in loop',
    transportPlaybackPositionAria: 'Playback position',
    transportVolumeRegionAria: 'Monitoring volume',
    transportVolumeSliderAria: 'Playback volume',
    transportVolumeSliderTitle: 'Monitoring volume (does not affect WAV export)',
    transportMuteAria: 'Mute',
    transportMuteTitle: 'Mute (M)',
    transportUnmuteAria: 'Unmute',
    transportUnmuteTitle: 'Unmute (M)',
    transportWavFormatAria: 'WAV format',
    transportWav16: 'WAV 16-bit',
    transportWav24: 'WAV 24-bit',
    transportWav32: 'WAV 32-bit float',
    transportExport: 'Export WAV',
    transportExporting: 'Exporting…',
    transportExportTitle: 'Export seamless WAV loop (Ctrl+S)',

    trimTitle: 'Trim source file',
    trimCloseAria: 'Close trim dialog',
    trimCloseTitle: 'Close (Esc)',
    trimStartLabel: 'Selection start',
    trimEndLabel: 'Selection end',
    trimDurationLabel: 'Selection duration',
    trimVolumeAria: 'Preview volume',
    trimPlay: 'Preview',
    trimStop: 'Stop',
    trimUseFull: 'Use full file',
    trimApply: 'Apply trim',

    confirmCancelDefault: 'Cancel',
    confirmCloseAria: 'Close',
    confirmClearTitle: 'Clear current project?',
    confirmClearDesc: '"{fileName}" and the current seam settings will be reset. You can open or drop a new file.',
    confirmClearAction: 'Clear',
    confirmReplaceTitle: 'Open a new file?',
    confirmReplaceDesc: '"{fileName}" will be replaced with the new file. Unsaved seam settings will be reset.',
    confirmReplaceDetail: 'New file: {fileName}',
    confirmReplaceAction: 'Open new file',

    dropOverlayText: 'Drop audio or video to replace the current file',

    dialogOpenTitle: 'Open audio or video file',
    dialogFilterAllMedia: 'Audio & Video',
    dialogFilterAudio: 'Audio files',
    dialogFilterVideo: 'Video files (extract audio)',
    dialogSaveTitle: 'Export seamless WAV loop',
    dialogFilterWav: 'WAV Audio',

    statusReady: 'Ready',
    statusExtractingVideo: 'Extracting audio track from video…',
    statusDecodingAudio: 'Decoding audio file…',
    statusOpenedHint: 'Opened {fileName} · select a range or use full file',
    statusTrimCancelled: 'Trim cancelled',
    statusPreparingAnalysis: 'Preparing analysis…',
    statusAnalyzingAudio: 'Multi-threaded musical analysis…',
    statusNoSeamsFound: 'No suitable seams found',
    statusAnalysisCancelled: 'Analysis cancelled',
    statusSnappedZeroCrossing: 'Snapped to zero crossing',
    statusExportCancelled: 'Export cancelled',
    statusExportWriting: 'Writing WAV at native sample rate…',
    statusExportSaved: 'Saved: {fileName}',

    errorUnsupportedFormat: 'Unsupported format. Supported: WAV, FLAC, MP3, OGG, M4A, AAC and video MP4, MOV, MKV, WebM, AVI, WMV.',
    errorDecodeFailed: 'Failed to decode file',
    errorLoadPrefix: 'Load error',
    errorOpenDialogPrefix: 'Failed to open dialog',
    errorSeamRecalcPrefix: 'Seam update error',
    errorTrimPrefix: 'Trim error',
    errorAnalysisPrefix: 'Analysis error',
    errorSnapPrefix: 'Snap error',
    errorPlaybackPrefix: 'Playback error',
    errorAuditionPrefix: 'Audition error',
    errorExportPrefix: 'Export error',

    stagePrepare: 'Preparing audio signal',
    stageStft: 'Spectral analysis (STFT)',
    stageTempo: 'Detecting tempo and beat grid',
    stageHarmony: 'Analyzing harmony and meter',
    stageSimilarity: 'Building musical similarity matrix',
    stageSearch: 'Searching musical loops',
    stagePhase: 'Phase-aligning stereo channels',
    stageSelect: 'Selecting best loops',
    stageDone: 'Analysis complete',
  },

  ru: {
    titlebarClear: 'Очистить',
    titlebarClearTitle: 'Очистить проект и загрузить новый файл',
    titlebarOpen: 'Открыть',
    titlebarOpenTitle: 'Открыть аудио или видеофайл (Ctrl+O)',
    titlebarLangLabel: 'Язык интерфейса',
    titlebarWindowControls: 'Управление окном',
    titlebarMinimize: 'Свернуть',
    titlebarMaximize: 'Развернуть',
    titlebarMaximizeAria: 'Развернуть окно',
    titlebarRestore: 'Восстановить',
    titlebarRestoreAria: 'Восстановить окно',
    titlebarClose: 'Закрыть',

    emptyRegionAria: 'Загрузка аудиофайла',
    emptyLoadingTitle: 'Извлечение и декодирование аудио…',
    emptyDragTitle: 'Отпустите файл, чтобы открыть',
    emptyDefaultTitle: 'Откройте или перетащите аудио или видео',
    emptyLoadingBtn: 'Загрузка…',
    emptyChooseBtn: 'Выбрать файл',
    emptySpec1Title: 'Оригинальная частота без ресэмплинга',
    emptySpec1Desc: 'Сохранение исходной сетки отсчётов',
    emptySpec2Title: 'Многопоточный анализ на Rust',
    emptySpec2Desc: 'Поиск по гармонии, ритму и фазе',
    emptySpec3Title: 'Экспорт 16, 24 и 32-bit float WAV',
    emptySpec3Desc: 'Точная склейка без щелчков',

    waveformRegionAria: 'Волновая форма и границы петли',
    waveformZoomGroupAria: 'Масштаб волновой формы',
    waveformZoomOut: 'Уменьшить масштаб',
    waveformZoomCurrentAria: 'Текущий масштаб',
    waveformZoomIn: 'Увеличить масштаб',
    waveformFitTrack: 'Весь трек',
    waveformFitTrackTitle: 'Показать весь трек',
    waveformToSeam: 'К стыку',
    waveformToSeamTitle: 'Приблизить область стыка',
    waveformBeats: 'Доли',
    waveformBeatsDisabledTitle: 'Сетка долей появится после анализа',
    waveformBeatsToggleTitle: 'Показать или скрыть сетку долей',
    waveformPanbarAria: 'Навигация по волновой форме',

    seamRegionAria: 'Инспектор стыка',
    seamTitle: 'Стык',
    seamLegendAria: 'Легенда осциллограммы',
    seamLegendTail: 'Конец',
    seamLegendHead: 'Начало',
    seamLegendBlended: 'Склейка',
    seamMetricPhase: 'Фаза',
    seamMetricSmoothness: 'Гладкость',
    seamScopeAria: 'Осциллограмма совмещения конца и начала петли',
    seamStart: 'Начало',
    seamEnd: 'Конец',
    seamNudgeStartAria: 'Точная подстройка начала',
    seamNudgeEndAria: 'Точная подстройка конца',
    seamSnapTitle: 'Привязать к zero crossing',
    seamSnapStartAria: 'Привязать начало к zero crossing',
    seamSnapEndAria: 'Привязать конец к zero crossing',
    seamCrossfade: 'Кроссфейд',
    seamCurve: 'Кривая',
    seamCurveGroupAria: 'Кривая кроссфейда',
    seamCurveConstantGainTitle: 'Для фазово-согласованных петель',
    seamCurveEqualPowerTitle: 'Для пэдов и эмбиента',
    unitMs: 'мс',

    sidebarRegionAria: 'Варианты стыков',
    sidebarTitle: 'Стыки',
    sidebarAnalyzingFallback: 'Анализ…',
    sidebarCancel: 'Отменить',
    sidebarFindSeams: 'Найти стыки',
    sidebarEmptyAnalyzing: 'Подбор музыкальных точек петли…',
    sidebarEmptyIdle: 'Нажмите «Найти стыки» для автоподбора петли.',
    sidebarDiagAria: 'Диагностика стыка',
    sidebarDiagHarmony: 'Гармония',
    sidebarDiagPhrase: 'Фраза',
    sidebarDiagRhythm: 'Ритм',
    sidebarDiagPhase: 'Фаза',

    transportRegionAria: 'Транспорт и экспорт',
    transportPlay: 'Играть',
    transportPause: 'Пауза',
    transportPlayTitle: 'Воспроизведение / пауза (Space)',
    transportAudioUnavailable: 'Аудиоустройство вывода недоступно',
    transportSeam: 'Стык',
    transportSeamTitle: 'Прослушать переход за 2.5 секунды до стыка (S)',
    transportLoopPositionAria: 'Позиция в петле',
    transportPlaybackPositionAria: 'Позиция воспроизведения',
    transportVolumeRegionAria: 'Громкость мониторинга',
    transportVolumeSliderAria: 'Громкость воспроизведения',
    transportVolumeSliderTitle: 'Громкость мониторинга (не влияет на экспорт WAV)',
    transportMuteAria: 'Выключить звук',
    transportMuteTitle: 'Выключить звук (M)',
    transportUnmuteAria: 'Включить звук',
    transportUnmuteTitle: 'Включить звук (M)',
    transportWavFormatAria: 'Формат WAV',
    transportWav16: 'WAV 16-bit',
    transportWav24: 'WAV 24-bit',
    transportWav32: 'WAV 32-bit float',
    transportExport: 'Экспорт WAV',
    transportExporting: 'Экспорт…',
    transportExportTitle: 'Экспортировать бесшовную петлю WAV (Ctrl+S)',

    trimTitle: 'Обрезка исходного файла',
    trimCloseAria: 'Закрыть окно обрезки',
    trimCloseTitle: 'Закрыть (Esc)',
    trimStartLabel: 'Начало фрагмента',
    trimEndLabel: 'Конец фрагмента',
    trimDurationLabel: 'Длительность фрагмента',
    trimVolumeAria: 'Громкость предпрослушивания',
    trimPlay: 'Прослушать',
    trimStop: 'Стоп',
    trimUseFull: 'Использовать целиком',
    trimApply: 'Применить обрезку',

    confirmCancelDefault: 'Отмена',
    confirmCloseAria: 'Закрыть',
    confirmClearTitle: 'Очистить текущий проект?',
    confirmClearDesc: 'Файл «{fileName}» и текущие настройки стыка будут сброшены. Вы сможете открыть или перетащить новый файл.',
    confirmClearAction: 'Очистить',
    confirmReplaceTitle: 'Открыть новый файл?',
    confirmReplaceDesc: 'Текущий файл «{fileName}» будет заменён новым. Несохранённые настройки стыка будут сброшены.',
    confirmReplaceDetail: 'Новый файл: {fileName}',
    confirmReplaceAction: 'Открыть новый файл',

    dropOverlayText: 'Отпустите аудио или видео, чтобы заменить текущий файл',

    dialogOpenTitle: 'Открыть аудио или видеофайл',
    dialogFilterAllMedia: 'Аудио и видео',
    dialogFilterAudio: 'Аудиофайлы',
    dialogFilterVideo: 'Видеофайлы (извлечь аудио)',
    dialogSaveTitle: 'Экспорт бесшовной петли WAV',
    dialogFilterWav: 'WAV Audio',

    statusReady: 'Готово к работе',
    statusExtractingVideo: 'Извлечение аудиодорожки из видео…',
    statusDecodingAudio: 'Декодирование аудиофайла…',
    statusOpenedHint: 'Открыт {fileName} · выберите фрагмент или используйте целиком',
    statusTrimCancelled: 'Обрезка отменена',
    statusPreparingAnalysis: 'Подготовка анализа…',
    statusAnalyzingAudio: 'Многопоточный музыкальный анализ…',
    statusNoSeamsFound: 'Подходящие стыки не найдены',
    statusAnalysisCancelled: 'Анализ отменён',
    statusSnappedZeroCrossing: 'Привязано к zero crossing',
    statusExportCancelled: 'Экспорт отменён',
    statusExportWriting: 'Запись WAV в оригинальной частоте…',
    statusExportSaved: 'Сохранено: {fileName}',

    errorUnsupportedFormat: 'Неподдерживаемый формат. Поддерживаются WAV, FLAC, MP3, OGG, M4A, AAC и видео MP4, MOV, MKV, WebM, AVI, WMV.',
    errorDecodeFailed: 'Не удалось декодировать файл',
    errorLoadPrefix: 'Ошибка загрузки',
    errorOpenDialogPrefix: 'Не удалось открыть диалог',
    errorSeamRecalcPrefix: 'Ошибка пересчёта стыка',
    errorTrimPrefix: 'Ошибка обрезки',
    errorAnalysisPrefix: 'Ошибка анализа',
    errorSnapPrefix: 'Ошибка привязки',
    errorPlaybackPrefix: 'Ошибка воспроизведения',
    errorAuditionPrefix: 'Ошибка прослушивания',
    errorExportPrefix: 'Ошибка экспорта',

    stagePrepare: 'Подготовка аудиосигнала',
    stageStft: 'Спектральный анализ (STFT)',
    stageTempo: 'Определение темпа и ритмической сетки',
    stageHarmony: 'Анализ гармонии и размера такта',
    stageSimilarity: 'Построение матрицы музыкальной похожести',
    stageSearch: 'Поиск музыкальных петель',
    stagePhase: 'Фазовая подгонка стереоканалов',
    stageSelect: 'Отбор лучших петель',
    stageDone: 'Анализ завершён',
  },

  zh: {
    titlebarClear: '清除',
    titlebarClearTitle: '清除当前项目并加载新文件',
    titlebarOpen: '打开',
    titlebarOpenTitle: '打开音频或视频文件 (Ctrl+O)',
    titlebarLangLabel: '界面语言',
    titlebarWindowControls: '窗口控制',
    titlebarMinimize: '最小化',
    titlebarMaximize: '最大化',
    titlebarMaximizeAria: '最大化窗口',
    titlebarRestore: '还原',
    titlebarRestoreAria: '还原窗口',
    titlebarClose: '关闭',

    emptyRegionAria: '加载音频文件',
    emptyLoadingTitle: '正在提取并解码音频…',
    emptyDragTitle: '松开鼠标即可打开文件',
    emptyDefaultTitle: '打开或拖放音频或视频文件',
    emptyLoadingBtn: '加载中…',
    emptyChooseBtn: '选择文件',
    emptySpec1Title: '原始采样率，无重采样',
    emptySpec1Desc: '完整保留原始采样网格',
    emptySpec2Title: 'Rust 多线程分析',
    emptySpec2Desc: '按和声、节奏与相位精准匹配',
    emptySpec3Title: '支持 16/24/32-bit float WAV 导出',
    emptySpec3Desc: '精确无缝拼接，消除爆音',

    waveformRegionAria: '波形与循环边界',
    waveformZoomGroupAria: '波形缩放',
    waveformZoomOut: '缩小',
    waveformZoomCurrentAria: '当前缩放比例',
    waveformZoomIn: '放大',
    waveformFitTrack: '整轨',
    waveformFitTrackTitle: '显示整条音轨',
    waveformToSeam: '定位接缝',
    waveformToSeamTitle: '缩放至接缝区域',
    waveformBeats: '节拍',
    waveformBeatsDisabledTitle: '分析完成后将显示节拍网格',
    waveformBeatsToggleTitle: '显示或隐藏节拍网格',
    waveformPanbarAria: '波形导航条',

    seamRegionAria: '接缝检查器',
    seamTitle: '接缝',
    seamLegendAria: '示波器图例',
    seamLegendTail: '尾部',
    seamLegendHead: '头部',
    seamLegendBlended: '混合',
    seamMetricPhase: '相位',
    seamMetricSmoothness: '平滑度',
    seamScopeAria: '循环首尾对齐示波器',
    seamStart: '起点',
    seamEnd: '终点',
    seamNudgeStartAria: '微调起点',
    seamNudgeEndAria: '微调终点',
    seamSnapTitle: '吸附到过零点',
    seamSnapStartAria: '将起点吸附到过零点',
    seamSnapEndAria: '将终点吸附到过零点',
    seamCrossfade: '交叉淡化',
    seamCurve: '曲线',
    seamCurveGroupAria: '交叉淡化曲线',
    seamCurveConstantGainTitle: '适用于相位对齐的循环',
    seamCurveEqualPowerTitle: '适用于铺底音色与氛围音乐',
    unitMs: 'ms',

    sidebarRegionAria: '候选接缝',
    sidebarTitle: '接缝',
    sidebarAnalyzingFallback: '分析中…',
    sidebarCancel: '取消',
    sidebarFindSeams: '查找接缝',
    sidebarEmptyAnalyzing: '正在搜索音乐循环点…',
    sidebarEmptyIdle: '点击“查找接缝”以自动匹配循环点。',
    sidebarDiagAria: '接缝诊断',
    sidebarDiagHarmony: '和声',
    sidebarDiagPhrase: '乐句',
    sidebarDiagRhythm: '节奏',
    sidebarDiagPhase: '相位',

    transportRegionAria: '播放控制与导出',
    transportPlay: '播放',
    transportPause: '暂停',
    transportPlayTitle: '播放 / 暂停 (Space)',
    transportAudioUnavailable: '音频输出设备不可用',
    transportSeam: '接缝',
    transportSeamTitle: '从接缝前 2.5 秒试听过渡 (S)',
    transportLoopPositionAria: '循环内位置',
    transportPlaybackPositionAria: '播放进度',
    transportVolumeRegionAria: '监听音量',
    transportVolumeSliderAria: '播放音量',
    transportVolumeSliderTitle: '监听音量（不影响 WAV 导出）',
    transportMuteAria: '静音',
    transportMuteTitle: '静音 (M)',
    transportUnmuteAria: '取消静音',
    transportUnmuteTitle: '取消静音 (M)',
    transportWavFormatAria: 'WAV 格式',
    transportWav16: 'WAV 16-bit',
    transportWav24: 'WAV 24-bit',
    transportWav32: 'WAV 32-bit float',
    transportExport: '导出 WAV',
    transportExporting: '导出中…',
    transportExportTitle: '导出无缝 WAV 循环 (Ctrl+S)',

    trimTitle: '裁剪源文件',
    trimCloseAria: '关闭裁剪窗口',
    trimCloseTitle: '关闭 (Esc)',
    trimStartLabel: '选区起点',
    trimEndLabel: '选区终点',
    trimDurationLabel: '选区时长',
    trimVolumeAria: '试听音量',
    trimPlay: '试听',
    trimStop: '停止',
    trimUseFull: '使用完整文件',
    trimApply: '应用裁剪',

    confirmCancelDefault: '取消',
    confirmCloseAria: '关闭',
    confirmClearTitle: '清除当前项目？',
    confirmClearDesc: '文件“{fileName}”及当前接缝设置将被重置。之后您可以打开或拖放新文件。',
    confirmClearAction: '清除',
    confirmReplaceTitle: '打开新文件？',
    confirmReplaceDesc: '当前文件“{fileName}”将被替换，未保存的接缝设置将被重置。',
    confirmReplaceDetail: '新文件：{fileName}',
    confirmReplaceAction: '打开新文件',

    dropOverlayText: '松开音频或视频文件以替换当前文件',

    dialogOpenTitle: '打开音频或视频文件',
    dialogFilterAllMedia: '音频和视频',
    dialogFilterAudio: '音频文件',
    dialogFilterVideo: '视频文件（提取音频）',
    dialogSaveTitle: '导出无缝 WAV 循环',
    dialogFilterWav: 'WAV 音频',

    statusReady: '就绪',
    statusExtractingVideo: '正在从视频提取音轨…',
    statusDecodingAudio: '正在解码音频文件…',
    statusOpenedHint: '已打开 {fileName} · 请选择片段或使用完整文件',
    statusTrimCancelled: '已取消裁剪',
    statusPreparingAnalysis: '正在准备分析…',
    statusAnalyzingAudio: '正在进行多线程音乐分析…',
    statusNoSeamsFound: '未找到合适的接缝',
    statusAnalysisCancelled: '分析已取消',
    statusSnappedZeroCrossing: '已吸附到过零点',
    statusExportCancelled: '导出已取消',
    statusExportWriting: '正在按原始采样率写入 WAV…',
    statusExportSaved: '已保存：{fileName}',

    errorUnsupportedFormat: '不支持的格式。支持 WAV、FLAC、MP3、OGG、M4A、AAC 以及 MP4、MOV、MKV、WebM、AVI、WMV 视频。',
    errorDecodeFailed: '文件解码失败',
    errorLoadPrefix: '加载失败',
    errorOpenDialogPrefix: '无法打开对话框',
    errorSeamRecalcPrefix: '接缝计算失败',
    errorTrimPrefix: '裁剪失败',
    errorAnalysisPrefix: '分析失败',
    errorSnapPrefix: '吸附失败',
    errorPlaybackPrefix: '播放失败',
    errorAuditionPrefix: '试听失败',
    errorExportPrefix: '导出失败',

    stagePrepare: '准备音频信号',
    stageStft: '频谱分析 (STFT)',
    stageTempo: '检测速度与节拍网格',
    stageHarmony: '分析和声与拍号',
    stageSimilarity: '构建音乐相似度矩阵',
    stageSearch: '搜索音乐循环',
    stagePhase: '立体声相位对齐',
    stageSelect: '筛选最佳循环',
    stageDone: '分析完成',
  },

  ja: {
    titlebarClear: 'クリア',
    titlebarClearTitle: 'プロジェクトをクリアして新しいファイルを読み込む',
    titlebarOpen: '開く',
    titlebarOpenTitle: '音声または動画ファイルを開く (Ctrl+O)',
    titlebarLangLabel: '表示言語',
    titlebarWindowControls: 'ウィンドウ操作',
    titlebarMinimize: '最小化',
    titlebarMaximize: '最大化',
    titlebarMaximizeAria: 'ウィンドウを最大化',
    titlebarRestore: '元に戻す',
    titlebarRestoreAria: 'ウィンドウを元のサイズに戻す',
    titlebarClose: '閉じる',

    emptyRegionAria: '音声ファイルの読み込み',
    emptyLoadingTitle: '音声を抽出・デコード中…',
    emptyDragTitle: 'ファイルをドロップして開く',
    emptyDefaultTitle: '音声または動画を開くかドロップ',
    emptyLoadingBtn: '読み込み中…',
    emptyChooseBtn: 'ファイルを選択',
    emptySpec1Title: '元のサンプルレートを維持',
    emptySpec1Desc: 'リサンプリングなしでサンプル精度を保持',
    emptySpec2Title: 'Rust によるマルチスレッド解析',
    emptySpec2Desc: '和声・リズム・位相から最適点を探索',
    emptySpec3Title: '16 / 24 / 32-bit float WAV 書き出し',
    emptySpec3Desc: 'クリック音のない高精度シームレス結合',

    waveformRegionAria: '波形とループ範囲',
    waveformZoomGroupAria: '波形ズーム',
    waveformZoomOut: '縮小',
    waveformZoomCurrentAria: '現在のズーム倍率',
    waveformZoomIn: '拡大',
    waveformFitTrack: '全体',
    waveformFitTrackTitle: 'トラック全体を表示',
    waveformToSeam: '継ぎ目へ',
    waveformToSeamTitle: '継ぎ目周辺を拡大表示',
    waveformBeats: '拍',
    waveformBeatsDisabledTitle: '解析後に拍グリッドが表示されます',
    waveformBeatsToggleTitle: '拍グリッドの表示を切り替え',
    waveformPanbarAria: '波形ナビゲーション',

    seamRegionAria: '継ぎ目インスペクター',
    seamTitle: '継ぎ目',
    seamLegendAria: 'オシロスコープ凡例',
    seamLegendTail: '終端',
    seamLegendHead: '先頭',
    seamLegendBlended: '合成',
    seamMetricPhase: '位相',
    seamMetricSmoothness: '滑らかさ',
    seamScopeAria: 'ループ終端と先頭の位相一致オシロスコープ',
    seamStart: '開始',
    seamEnd: '終了',
    seamNudgeStartAria: '開始位置を微調整',
    seamNudgeEndAria: '終了位置を微調整',
    seamSnapTitle: 'ゼロクロスにスナップ',
    seamSnapStartAria: '開始位置をゼロクロスにスナップ',
    seamSnapEndAria: '終了位置をゼロクロスにスナップ',
    seamCrossfade: 'クロスフェード',
    seamCurve: 'カーブ',
    seamCurveGroupAria: 'クロスフェードカーブ',
    seamCurveConstantGainTitle: '位相の揃ったループ向け',
    seamCurveEqualPowerTitle: 'パッドやアンビエント向け',
    unitMs: 'ms',

    sidebarRegionAria: '継ぎ目候補',
    sidebarTitle: '継ぎ目',
    sidebarAnalyzingFallback: '解析中…',
    sidebarCancel: 'キャンセル',
    sidebarFindSeams: '継ぎ目を検索',
    sidebarEmptyAnalyzing: '音楽的なループポイントを探索中…',
    sidebarEmptyIdle: '「継ぎ目を検索」を押してループを自動検出します。',
    sidebarDiagAria: '継ぎ目診断',
    sidebarDiagHarmony: '和声',
    sidebarDiagPhrase: 'フレーズ',
    sidebarDiagRhythm: 'リズム',
    sidebarDiagPhase: '位相',

    transportRegionAria: 'トランスポートと書き出し',
    transportPlay: '再生',
    transportPause: '一時停止',
    transportPlayTitle: '再生 / 一時停止 (Space)',
    transportAudioUnavailable: '音声出力デバイスが利用できません',
    transportSeam: '継ぎ目',
    transportSeamTitle: '継ぎ目の 2.5 秒前から試聴 (S)',
    transportLoopPositionAria: 'ループ内の再生位置',
    transportPlaybackPositionAria: '再生位置',
    transportVolumeRegionAria: 'モニター音量',
    transportVolumeSliderAria: '再生音量',
    transportVolumeSliderTitle: 'モニター音量（WAV 書き出しには影響しません）',
    transportMuteAria: 'ミュート',
    transportMuteTitle: 'ミュート (M)',
    transportUnmuteAria: 'ミュート解除',
    transportUnmuteTitle: 'ミュート解除 (M)',
    transportWavFormatAria: 'WAV 形式',
    transportWav16: 'WAV 16-bit',
    transportWav24: 'WAV 24-bit',
    transportWav32: 'WAV 32-bit float',
    transportExport: 'WAV 書き出し',
    transportExporting: '書き出し中…',
    transportExportTitle: 'シームレス WAV ループを書き出す (Ctrl+S)',

    trimTitle: '元ファイルのトリミング',
    trimCloseAria: 'トリミング画面を閉じる',
    trimCloseTitle: '閉じる (Esc)',
    trimStartLabel: '選択開始',
    trimEndLabel: '選択終了',
    trimDurationLabel: '選択範囲の長さ',
    trimVolumeAria: 'プレビュー音量',
    trimPlay: '試聴',
    trimStop: '停止',
    trimUseFull: '全体を使用',
    trimApply: 'トリミングを適用',

    confirmCancelDefault: 'キャンセル',
    confirmCloseAria: '閉じる',
    confirmClearTitle: '現在のプロジェクトをクリアしますか？',
    confirmClearDesc: '「{fileName}」と現在の継ぎ目設定がリセットされます。新しいファイルを開いたりドロップできます。',
    confirmClearAction: 'クリア',
    confirmReplaceTitle: '新しいファイルを開きますか？',
    confirmReplaceDesc: '現在のファイル「{fileName}」は新しいファイルに置き換わります。未保存の継ぎ目設定はリセットされます。',
    confirmReplaceDetail: '新しいファイル: {fileName}',
    confirmReplaceAction: '新しいファイルを開く',

    dropOverlayText: '音声または動画をドロップして現在のファイルを置き換える',

    dialogOpenTitle: '音声または動画ファイルを開く',
    dialogFilterAllMedia: '音声と動画',
    dialogFilterAudio: '音声ファイル',
    dialogFilterVideo: '動画ファイル（音声抽出）',
    dialogSaveTitle: 'シームレス WAV ループを書き出し',
    dialogFilterWav: 'WAV 音声',

    statusReady: '準備完了',
    statusExtractingVideo: '動画から音声トラックを抽出中…',
    statusDecodingAudio: '音声ファイルをデコード中…',
    statusOpenedHint: '{fileName} を開きました · 範囲を選択するか全体を使用',
    statusTrimCancelled: 'トリミングをキャンセルしました',
    statusPreparingAnalysis: '解析を準備中…',
    statusAnalyzingAudio: 'マルチスレッド音楽解析を実行中…',
    statusNoSeamsFound: '適切な継ぎ目が見つかりませんでした',
    statusAnalysisCancelled: '解析をキャンセルしました',
    statusSnappedZeroCrossing: 'ゼロクロスにスナップしました',
    statusExportCancelled: '書き出しをキャンセルしました',
    statusExportWriting: '元のサンプルレートで WAV を書き出し中…',
    statusExportSaved: '保存しました: {fileName}',

    errorUnsupportedFormat: '非対応の形式です。WAV、FLAC、MP3、OGG、M4A、AAC および動画 MP4、MOV、MKV、WebM、AVI、WMV に対応しています。',
    errorDecodeFailed: 'ファイルをデコードできませんでした',
    errorLoadPrefix: '読み込みエラー',
    errorOpenDialogPrefix: 'ダイアログを開けませんでした',
    errorSeamRecalcPrefix: '継ぎ目の更新エラー',
    errorTrimPrefix: 'トリミングエラー',
    errorAnalysisPrefix: '解析エラー',
    errorSnapPrefix: 'スナップエラー',
    errorPlaybackPrefix: '再生エラー',
    errorAuditionPrefix: '試聴エラー',
    errorExportPrefix: '書き出しエラー',

    stagePrepare: '音声信号を準備中',
    stageStft: 'スペクトル解析 (STFT)',
    stageTempo: 'テンポと拍グリッドを検出中',
    stageHarmony: '和声と拍子を解析中',
    stageSimilarity: '音楽類似度行列を構築中',
    stageSearch: '音楽ループを探索中',
    stagePhase: 'ステレオ位相を精密調整中',
    stageSelect: '最適なループを選定中',
    stageDone: '解析完了',
  },

  es: {
    titlebarClear: 'Limpiar',
    titlebarClearTitle: 'Limpiar proyecto y cargar un nuevo archivo',
    titlebarOpen: 'Abrir',
    titlebarOpenTitle: 'Abrir archivo de audio o vídeo (Ctrl+O)',
    titlebarLangLabel: 'Idioma de la interfaz',
    titlebarWindowControls: 'Controles de ventana',
    titlebarMinimize: 'Minimizar',
    titlebarMaximize: 'Maximizar',
    titlebarMaximizeAria: 'Maximizar ventana',
    titlebarRestore: 'Restaurar',
    titlebarRestoreAria: 'Restaurar ventana',
    titlebarClose: 'Cerrar',

    emptyRegionAria: 'Cargar archivo de audio',
    emptyLoadingTitle: 'Extrayendo y decodificando audio…',
    emptyDragTitle: 'Suelta el archivo para abrirlo',
    emptyDefaultTitle: 'Abre o arrastra un archivo de audio o vídeo',
    emptyLoadingBtn: 'Cargando…',
    emptyChooseBtn: 'Elegir archivo',
    emptySpec1Title: 'Frecuencia original sin remuestreo',
    emptySpec1Desc: 'Conserva la rejilla de muestras original',
    emptySpec2Title: 'Análisis multihilo en Rust',
    emptySpec2Desc: 'Coincidencia por armonía, ritmo y fase',
    emptySpec3Title: 'Exportación WAV 16, 24 y 32-bit float',
    emptySpec3Desc: 'Empalme preciso sin clics',

    waveformRegionAria: 'Forma de onda y límites del bucle',
    waveformZoomGroupAria: 'Zoom de forma de onda',
    waveformZoomOut: 'Alejar',
    waveformZoomCurrentAria: 'Zoom actual',
    waveformZoomIn: 'Acercar',
    waveformFitTrack: 'Toda la pista',
    waveformFitTrackTitle: 'Mostrar toda la pista',
    waveformToSeam: 'Al corte',
    waveformToSeamTitle: 'Acercar a la zona de empalme',
    waveformBeats: 'Pulsos',
    waveformBeatsDisabledTitle: 'La rejilla de pulsos aparecerá tras el análisis',
    waveformBeatsToggleTitle: 'Mostrar u ocultar rejilla de pulsos',
    waveformPanbarAria: 'Navegación de forma de onda',

    seamRegionAria: 'Inspector de empalme',
    seamTitle: 'Empalme',
    seamLegendAria: 'Leyenda del osciloscopio',
    seamLegendTail: 'Final',
    seamLegendHead: 'Inicio',
    seamLegendBlended: 'Mezcla',
    seamMetricPhase: 'Fase',
    seamMetricSmoothness: 'Suavidad',
    seamScopeAria: 'Osciloscopio de alineación entre final e inicio del bucle',
    seamStart: 'Inicio',
    seamEnd: 'Fin',
    seamNudgeStartAria: 'Ajuste fino del inicio',
    seamNudgeEndAria: 'Ajuste fino del final',
    seamSnapTitle: 'Ajustar al cruce por cero',
    seamSnapStartAria: 'Ajustar inicio al cruce por cero',
    seamSnapEndAria: 'Ajustar final al cruce por cero',
    seamCrossfade: 'Crossfade',
    seamCurve: 'Curva',
    seamCurveGroupAria: 'Curva de crossfade',
    seamCurveConstantGainTitle: 'Ideal para bucles alineados en fase',
    seamCurveEqualPowerTitle: 'Ideal para pads y texturas ambientales',
    unitMs: 'ms',

    sidebarRegionAria: 'Candidatos de empalme',
    sidebarTitle: 'Empalmes',
    sidebarAnalyzingFallback: 'Analizando…',
    sidebarCancel: 'Cancelar',
    sidebarFindSeams: 'Buscar empalmes',
    sidebarEmptyAnalyzing: 'Buscando puntos musicales de bucle…',
    sidebarEmptyIdle: 'Pulsa «Buscar empalmes» para detectar bucles automáticamente.',
    sidebarDiagAria: 'Diagnóstico del empalme',
    sidebarDiagHarmony: 'Armonía',
    sidebarDiagPhrase: 'Frase',
    sidebarDiagRhythm: 'Ritmo',
    sidebarDiagPhase: 'Fase',

    transportRegionAria: 'Transporte y exportación',
    transportPlay: 'Reproducir',
    transportPause: 'Pausa',
    transportPlayTitle: 'Reproducir / pausar (Space)',
    transportAudioUnavailable: 'Dispositivo de salida de audio no disponible',
    transportSeam: 'Empalme',
    transportSeamTitle: 'Escuchar transición 2,5 segundos antes del empalme (S)',
    transportLoopPositionAria: 'Posición en el bucle',
    transportPlaybackPositionAria: 'Posición de reproducción',
    transportVolumeRegionAria: 'Volumen de monitorización',
    transportVolumeSliderAria: 'Volumen de reproducción',
    transportVolumeSliderTitle: 'Volumen de monitorización (no afecta a la exportación WAV)',
    transportMuteAria: 'Silenciar',
    transportMuteTitle: 'Silenciar (M)',
    transportUnmuteAria: 'Activar sonido',
    transportUnmuteTitle: 'Activar sonido (M)',
    transportWavFormatAria: 'Formato WAV',
    transportWav16: 'WAV 16-bit',
    transportWav24: 'WAV 24-bit',
    transportWav32: 'WAV 32-bit float',
    transportExport: 'Exportar WAV',
    transportExporting: 'Exportando…',
    transportExportTitle: 'Exportar bucle WAV sin cortes (Ctrl+S)',

    trimTitle: 'Recortar archivo fuente',
    trimCloseAria: 'Cerrar ventana de recorte',
    trimCloseTitle: 'Cerrar (Esc)',
    trimStartLabel: 'Inicio de selección',
    trimEndLabel: 'Fin de selección',
    trimDurationLabel: 'Duración de selección',
    trimVolumeAria: 'Volumen de vista previa',
    trimPlay: 'Escuchar',
    trimStop: 'Detener',
    trimUseFull: 'Usar archivo completo',
    trimApply: 'Aplicar recorte',

    confirmCancelDefault: 'Cancelar',
    confirmCloseAria: 'Cerrar',
    confirmClearTitle: '¿Limpiar el proyecto actual?',
    confirmClearDesc: 'Se restablecerán «{fileName}» y los ajustes actuales del empalme. Podrás abrir o arrastrar otro archivo.',
    confirmClearAction: 'Limpiar',
    confirmReplaceTitle: '¿Abrir un archivo nuevo?',
    confirmReplaceDesc: '«{fileName}» será reemplazado por el archivo nuevo. Se perderán los ajustes de empalme no guardados.',
    confirmReplaceDetail: 'Archivo nuevo: {fileName}',
    confirmReplaceAction: 'Abrir archivo nuevo',

    dropOverlayText: 'Suelta audio o vídeo para reemplazar el archivo actual',

    dialogOpenTitle: 'Abrir archivo de audio o vídeo',
    dialogFilterAllMedia: 'Audio y vídeo',
    dialogFilterAudio: 'Archivos de audio',
    dialogFilterVideo: 'Archivos de vídeo (extraer audio)',
    dialogSaveTitle: 'Exportar bucle WAV sin cortes',
    dialogFilterWav: 'Audio WAV',

    statusReady: 'Listo',
    statusExtractingVideo: 'Extrayendo pista de audio del vídeo…',
    statusDecodingAudio: 'Decodificando archivo de audio…',
    statusOpenedHint: 'Abierto {fileName} · selecciona un tramo o usa el archivo completo',
    statusTrimCancelled: 'Recorte cancelado',
    statusPreparingAnalysis: 'Preparando análisis…',
    statusAnalyzingAudio: 'Análisis musical multihilo…',
    statusNoSeamsFound: 'No se encontraron empalmes adecuados',
    statusAnalysisCancelled: 'Análisis cancelado',
    statusSnappedZeroCrossing: 'Ajustado al cruce por cero',
    statusExportCancelled: 'Exportación cancelada',
    statusExportWriting: 'Escribiendo WAV a frecuencia original…',
    statusExportSaved: 'Guardado: {fileName}',

    errorUnsupportedFormat: 'Formato no compatible. Se admiten WAV, FLAC, MP3, OGG, M4A, AAC y vídeo MP4, MOV, MKV, WebM, AVI, WMV.',
    errorDecodeFailed: 'No se pudo decodificar el archivo',
    errorLoadPrefix: 'Error de carga',
    errorOpenDialogPrefix: 'No se pudo abrir el diálogo',
    errorSeamRecalcPrefix: 'Error al recalcular el empalme',
    errorTrimPrefix: 'Error al recortar',
    errorAnalysisPrefix: 'Error de análisis',
    errorSnapPrefix: 'Error de ajuste',
    errorPlaybackPrefix: 'Error de reproducción',
    errorAuditionPrefix: 'Error de escucha',
    errorExportPrefix: 'Error de exportación',

    stagePrepare: 'Preparando señal de audio',
    stageStft: 'Análisis espectral (STFT)',
    stageTempo: 'Detectando tempo y rejilla rítmica',
    stageHarmony: 'Analizando armonía y compás',
    stageSimilarity: 'Construyendo matriz de similitud musical',
    stageSearch: 'Buscando bucles musicales',
    stagePhase: 'Alineación de fase estéreo',
    stageSelect: 'Seleccionando los mejores bucles',
    stageDone: 'Análisis completado',
  },

  de: {
    titlebarClear: 'Leeren',
    titlebarClearTitle: 'Projekt leeren und neue Datei laden',
    titlebarOpen: 'Öffnen',
    titlebarOpenTitle: 'Audio- oder Videodatei öffnen (Ctrl+O)',
    titlebarLangLabel: 'Oberflächensprache',
    titlebarWindowControls: 'Fenstersteuerung',
    titlebarMinimize: 'Minimieren',
    titlebarMaximize: 'Maximieren',
    titlebarMaximizeAria: 'Fenster maximieren',
    titlebarRestore: 'Wiederherstellen',
    titlebarRestoreAria: 'Fenster wiederherstellen',
    titlebarClose: 'Schließen',

    emptyRegionAria: 'Audiodatei laden',
    emptyLoadingTitle: 'Audio wird extrahiert und dekodiert…',
    emptyDragTitle: 'Datei zum Öffnen loslassen',
    emptyDefaultTitle: 'Audio- oder Videodatei öffnen oder ablegen',
    emptyLoadingBtn: 'Wird geladen…',
    emptyChooseBtn: 'Datei wählen',
    emptySpec1Title: 'Original-Abtastrate ohne Resampling',
    emptySpec1Desc: 'Erhält das ursprüngliche Sample-Raster',
    emptySpec2Title: 'Multithread-Analyse in Rust',
    emptySpec2Desc: 'Abgleich nach Harmonie, Rhythmus und Phase',
    emptySpec3Title: 'WAV-Export in 16, 24 & 32-Bit Float',
    emptySpec3Desc: 'Präzise Übergänge ohne Knackser',

    waveformRegionAria: 'Wellenform und Loop-Grenzen',
    waveformZoomGroupAria: 'Wellenform-Zoom',
    waveformZoomOut: 'Verkleinern',
    waveformZoomCurrentAria: 'Aktueller Zoom',
    waveformZoomIn: 'Vergrößern',
    waveformFitTrack: 'Gesamter Track',
    waveformFitTrackTitle: 'Gesamten Track anzeigen',
    waveformToSeam: 'Zum Übergang',
    waveformToSeamTitle: 'Übergangsbereich heranzoomen',
    waveformBeats: 'Beats',
    waveformBeatsDisabledTitle: 'Beat-Raster erscheint nach der Analyse',
    waveformBeatsToggleTitle: 'Beat-Raster ein- oder ausblenden',
    waveformPanbarAria: 'Wellenform-Navigation',

    seamRegionAria: 'Übergangs-Inspektor',
    seamTitle: 'Übergang',
    seamLegendAria: 'Oszilloskop-Legende',
    seamLegendTail: 'Ende',
    seamLegendHead: 'Anfang',
    seamLegendBlended: 'Mix',
    seamMetricPhase: 'Phase',
    seamMetricSmoothness: 'Glätte',
    seamScopeAria: 'Oszilloskop der Ausrichtung von Loop-Ende und -Anfang',
    seamStart: 'Start',
    seamEnd: 'Ende',
    seamNudgeStartAria: 'Start feinjustieren',
    seamNudgeEndAria: 'Ende feinjustieren',
    seamSnapTitle: 'Am Nulldurchgang einrasten',
    seamSnapStartAria: 'Start am Nulldurchgang einrasten',
    seamSnapEndAria: 'Ende am Nulldurchgang einrasten',
    seamCrossfade: 'Crossfade',
    seamCurve: 'Kurve',
    seamCurveGroupAria: 'Crossfade-Kurve',
    seamCurveConstantGainTitle: 'Für phasenkorrelierte Loops',
    seamCurveEqualPowerTitle: 'Für Pads und Ambient-Flächen',
    unitMs: 'ms',

    sidebarRegionAria: 'Übergangskandidaten',
    sidebarTitle: 'Übergänge',
    sidebarAnalyzingFallback: 'Analysiere…',
    sidebarCancel: 'Abbrechen',
    sidebarFindSeams: 'Übergänge finden',
    sidebarEmptyAnalyzing: 'Suche nach musikalischen Loop-Punkten…',
    sidebarEmptyIdle: 'Auf „Übergänge finden“ klicken, um Loops automatisch zu erkennen.',
    sidebarDiagAria: 'Übergangsdiagnose',
    sidebarDiagHarmony: 'Harmonie',
    sidebarDiagPhrase: 'Phrase',
    sidebarDiagRhythm: 'Rhythmus',
    sidebarDiagPhase: 'Phase',

    transportRegionAria: 'Transport und Export',
    transportPlay: 'Abspielen',
    transportPause: 'Pause',
    transportPlayTitle: 'Wiedergabe / Pause (Space)',
    transportAudioUnavailable: 'Audio-Ausgabegerät nicht verfügbar',
    transportSeam: 'Übergang',
    transportSeamTitle: 'Übergang 2,5 Sekunden vorher vorhören (S)',
    transportLoopPositionAria: 'Position im Loop',
    transportPlaybackPositionAria: 'Wiedergabeposition',
    transportVolumeRegionAria: 'Abhörlautstärke',
    transportVolumeSliderAria: 'Wiedergabelautstärke',
    transportVolumeSliderTitle: 'Abhörlautstärke (beeinflusst WAV-Export nicht)',
    transportMuteAria: 'Stummschalten',
    transportMuteTitle: 'Stummschalten (M)',
    transportUnmuteAria: 'Ton einschalten',
    transportUnmuteTitle: 'Ton einschalten (M)',
    transportWavFormatAria: 'WAV-Format',
    transportWav16: 'WAV 16-bit',
    transportWav24: 'WAV 24-bit',
    transportWav32: 'WAV 32-bit float',
    transportExport: 'WAV exportieren',
    transportExporting: 'Exportiere…',
    transportExportTitle: 'Nahtlosen WAV-Loop exportieren (Ctrl+S)',

    trimTitle: 'Quelldatei zuschneiden',
    trimCloseAria: 'Zuschneidefenster schließen',
    trimCloseTitle: 'Schließen (Esc)',
    trimStartLabel: 'Auswahlstart',
    trimEndLabel: 'Auswahlende',
    trimDurationLabel: 'Auswahldauer',
    trimVolumeAria: 'Vorschaulautstärke',
    trimPlay: 'Vorhören',
    trimStop: 'Stopp',
    trimUseFull: 'Gesamte Datei',
    trimApply: 'Zuschnitt anwenden',

    confirmCancelDefault: 'Abbrechen',
    confirmCloseAria: 'Schließen',
    confirmClearTitle: 'Aktuelles Projekt leeren?',
    confirmClearDesc: '„{fileName}“ und die aktuellen Übergangseinstellungen werden zurückgesetzt. Sie können danach eine neue Datei öffnen oder ablegen.',
    confirmClearAction: 'Leeren',
    confirmReplaceTitle: 'Neue Datei öffnen?',
    confirmReplaceDesc: '„{fileName}“ wird durch die neue Datei ersetzt. Nicht gespeicherte Übergangseinstellungen werden zurückgesetzt.',
    confirmReplaceDetail: 'Neue Datei: {fileName}',
    confirmReplaceAction: 'Neue Datei öffnen',

    dropOverlayText: 'Audio oder Video ablegen, um die aktuelle Datei zu ersetzen',

    dialogOpenTitle: 'Audio- oder Videodatei öffnen',
    dialogFilterAllMedia: 'Audio & Video',
    dialogFilterAudio: 'Audiodateien',
    dialogFilterVideo: 'Videodateien (Audio extrahieren)',
    dialogSaveTitle: 'Nahtlosen WAV-Loop exportieren',
    dialogFilterWav: 'WAV-Audio',

    statusReady: 'Bereit',
    statusExtractingVideo: 'Extrahiere Audiospur aus Video…',
    statusDecodingAudio: 'Dekodiere Audiodatei…',
    statusOpenedHint: '{fileName} geöffnet · Bereich wählen oder gesamte Datei nutzen',
    statusTrimCancelled: 'Zuschnitt abgebrochen',
    statusPreparingAnalysis: 'Analyse wird vorbereitet…',
    statusAnalyzingAudio: 'Multithread-Musikanalyse läuft…',
    statusNoSeamsFound: 'Keine passenden Übergänge gefunden',
    statusAnalysisCancelled: 'Analyse abgebrochen',
    statusSnappedZeroCrossing: 'Am Nulldurchgang eingerastet',
    statusExportCancelled: 'Export abgebrochen',
    statusExportWriting: 'Schreibe WAV in Original-Abtastrate…',
    statusExportSaved: 'Gespeichert: {fileName}',

    errorUnsupportedFormat: 'Nicht unterstütztes Format. Unterstützt werden WAV, FLAC, MP3, OGG, M4A, AAC sowie MP4, MOV, MKV, WebM, AVI, WMV.',
    errorDecodeFailed: 'Datei konnte nicht dekodiert werden',
    errorLoadPrefix: 'Ladefehler',
    errorOpenDialogPrefix: 'Dialog konnte nicht geöffnet werden',
    errorSeamRecalcPrefix: 'Fehler bei Übergangsberechnung',
    errorTrimPrefix: 'Zuschnittfehler',
    errorAnalysisPrefix: 'Analysefehler',
    errorSnapPrefix: 'Einrastfehler',
    errorPlaybackPrefix: 'Wiedergabefehler',
    errorAuditionPrefix: 'Vorhörfehler',
    errorExportPrefix: 'Exportfehler',

    stagePrepare: 'Audiosignal wird vorbereitet',
    stageStft: 'Spektralanalyse (STFT)',
    stageTempo: 'Tempo und Beat-Raster werden erkannt',
    stageHarmony: 'Harmonie und Taktart werden analysiert',
    stageSimilarity: 'Musikalische Ähnlichkeitsmatrix wird erstellt',
    stageSearch: 'Suche nach musikalischen Loops',
    stagePhase: 'Phasenausrichtung der Stereokanäle',
    stageSelect: 'Beste Loops werden ausgewählt',
    stageDone: 'Analyse abgeschlossen',
  },
}

const STORAGE_KEY = 'seamforge.locale'

const BACKEND_STAGE_KEY_MAP: Record<string, keyof TranslationMap> = {
  'Подготовка аудиосигнала': 'stagePrepare',
  'Спектральный анализ (STFT)': 'stageStft',
  'Определение темпа и ритмической сетки': 'stageTempo',
  'Анализ гармонии и размера такта': 'stageHarmony',
  'Построение матрицы музыкальной похожести': 'stageSimilarity',
  'Поиск музыкальных петель': 'stageSearch',
  'Фазовая подгонка стереоканалов': 'stagePhase',
  'Отбор лучших петель': 'stageSelect',
  'Анализ завершён': 'stageDone',
}

export function isSupportedLocale(value: string): value is Locale {
  return value === 'en' || value === 'ru' || value === 'zh' || value === 'ja' || value === 'es' || value === 'de'
}

export function detectInitialLocale(): Locale {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = window.localStorage.getItem(STORAGE_KEY)
      if (saved && isSupportedLocale(saved)) {
        return saved
      }
    }
  } catch {
    // Ignore storage access errors
  }

  if (typeof navigator !== 'undefined' && typeof navigator.language === 'string') {
    const prefix = navigator.language.toLowerCase().split(/[-_]/)[0]
    if (isSupportedLocale(prefix)) {
      return prefix
    }
  }

  return 'en'
}

export function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    key in vars ? String(vars[key]) : `{${key}}`,
  )
}

export function translateAnalysisStage(stage: string, t: TranslationMap): string {
  if (!stage) return ''
  const key = BACKEND_STAGE_KEY_MAP[stage]
  return key ? t[key] : stage
}

export function formatBarsLocalized(bars: number, locale: Locale): string {
  const n = Math.abs(Math.round(bars))
  switch (locale) {
    case 'ru': {
      const mod100 = n % 100
      const mod10 = n % 10
      if (mod100 >= 11 && mod100 <= 14) return `${n} тактов`
      if (mod10 === 1) return `${n} такт`
      if (mod10 >= 2 && mod10 <= 4) return `${n} такта`
      return `${n} тактов`
    }
    case 'en':
      return n === 1 ? '1 bar' : `${n} bars`
    case 'zh':
      return `${n} 小节`
    case 'ja':
      return `${n} 小節`
    case 'es':
      return n === 1 ? '1 compás' : `${n} compases`
    case 'de':
      return n === 1 ? '1 Takt' : `${n} Takte`
  }
}

export function formatSampleRateLocalized(hz: number, locale: Locale): string {
  const hzUnit = locale === 'ru' ? 'Гц' : 'Hz'
  const khzUnit = locale === 'ru' ? 'кГц' : 'kHz'
  if (!Number.isFinite(hz) || hz <= 0) {
    return `0 ${hzUnit}`
  }
  if (hz < 1000) {
    return `${Math.round(hz)} ${hzUnit}`
  }
  const khz = hz / 1000
  if (Number.isInteger(khz)) {
    return `${khz} ${khzUnit}`
  }
  return `${Number(khz.toFixed(2))} ${khzUnit}`
}

export function formatChannelLabel(channels: number, locale: Locale): string {
  if (channels === 1) {
    switch (locale) {
      case 'ru':
        return 'Моно'
      case 'zh':
        return '单声道'
      case 'ja':
        return 'モノラル'
      case 'en':
      case 'es':
      case 'de':
        return 'Mono'
    }
  }
  if (channels === 2) {
    switch (locale) {
      case 'ru':
        return 'Стерео'
      case 'zh':
        return '立体声'
      case 'ja':
        return 'ステレオ'
      case 'es':
        return 'Estéreo'
      case 'en':
      case 'de':
        return 'Stereo'
    }
  }
  switch (locale) {
    case 'ru':
      return `${channels} кан.`
    case 'zh':
      return `${channels} 声道`
    case 'es':
      return `${channels} can.`
    case 'de':
      return `${channels} Kan.`
    case 'en':
    case 'ja':
      return `${channels} ch`
  }
}

export interface I18nContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: TranslationMap
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'en',
  setLocale: () => undefined,
  t: TRANSLATIONS.en,
})

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectInitialLocale)

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Ignore storage errors
    }
  }, [])

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale
    }
  }, [locale])

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t: TRANSLATIONS[locale],
    }),
    [locale, setLocale],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext)
}
