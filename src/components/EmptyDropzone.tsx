import { AlertCircle, AudioWaveform, FolderOpen, Loader2, Upload } from 'lucide-react'

export interface EmptyDropzoneProps {
  isDragging: boolean
  isLoading: boolean
  errorMessage: string | null
  onOpenFile: () => void
}

export function EmptyDropzone({
  isDragging,
  isLoading,
  errorMessage,
  onOpenFile,
}: EmptyDropzoneProps) {
  return (
    <section
      className={`empty-stage ${isDragging ? 'is-dragging' : ''} ${isLoading ? 'is-loading' : ''}`}
      aria-label="Загрузка аудиофайла"
    >
      <div className="empty-card">
        <div className="empty-icon" aria-hidden="true">
          {isLoading ? (
            <Loader2 size={26} strokeWidth={1.75} className="is-spinning" />
          ) : isDragging ? (
            <Upload size={26} strokeWidth={1.75} />
          ) : (
            <AudioWaveform size={26} strokeWidth={1.75} />
          )}
        </div>

        <h1 className="empty-title">
          {isLoading
            ? 'Извлечение и декодирование аудио…'
            : isDragging
              ? 'Отпустите файл, чтобы открыть'
              : 'Откройте или перетащите аудио или видео'}
        </h1>

        <p className="empty-formats">WAV, FLAC, MP3, OGG, M4A, AAC · MP4, MOV, MKV, WebM, AVI</p>

        <button
          type="button"
          className="btn btn--primary empty-cta"
          onClick={onOpenFile}
          disabled={isLoading}
        >
          <FolderOpen size={15} strokeWidth={1.85} aria-hidden="true" />
          <span>{isLoading ? 'Загрузка…' : 'Выбрать файл'}</span>
        </button>

        {errorMessage && (
          <div className="empty-error" role="alert">
            <AlertCircle size={15} strokeWidth={1.85} aria-hidden="true" />
            <span>{errorMessage}</span>
          </div>
        )}

        <dl className="empty-specs">
          <div className="empty-spec-item">
            <dt>Оригинальная частота без ресэмплинга</dt>
            <dd>Сохранение исходной сетки отсчётов</dd>
          </div>
          <div className="empty-spec-item">
            <dt>Многопоточный анализ на Rust</dt>
            <dd>Поиск по гармонии, ритму и фазе</dd>
          </div>
          <div className="empty-spec-item">
            <dt>Экспорт 16, 24 и 32-bit float WAV</dt>
            <dd>Точная склейка без щелчков</dd>
          </div>
        </dl>
      </div>
    </section>
  )
}
