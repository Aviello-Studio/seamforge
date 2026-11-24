import { AlertCircle, AudioWaveform, FolderOpen, Loader2, Upload } from 'lucide-react'
import { useI18n } from '../lib/i18n'

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
  const { t } = useI18n()

  return (
    <section
      className={`empty-stage ${isDragging ? 'is-dragging' : ''} ${isLoading ? 'is-loading' : ''}`}
      aria-label={t.emptyRegionAria}
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
            ? t.emptyLoadingTitle
            : isDragging
              ? t.emptyDragTitle
              : t.emptyDefaultTitle}
        </h1>

        <p className="empty-formats">WAV, FLAC, MP3, OGG, M4A, AAC · MP4, MOV, MKV, WebM, AVI</p>

        <button
          type="button"
          className="btn btn--primary empty-cta"
          onClick={onOpenFile}
          disabled={isLoading}
        >
          <FolderOpen size={15} strokeWidth={1.85} aria-hidden="true" />
          <span>{isLoading ? t.emptyLoadingBtn : t.emptyChooseBtn}</span>
        </button>

        {errorMessage && (
          <div className="empty-error" role="alert">
            <AlertCircle size={15} strokeWidth={1.85} aria-hidden="true" />
            <span>{errorMessage}</span>
          </div>
        )}

        <dl className="empty-specs">
          <div className="empty-spec-item">
            <dt>{t.emptySpec1Title}</dt>
            <dd>{t.emptySpec1Desc}</dd>
          </div>
          <div className="empty-spec-item">
            <dt>{t.emptySpec2Title}</dt>
            <dd>{t.emptySpec2Desc}</dd>
          </div>
          <div className="empty-spec-item">
            <dt>{t.emptySpec3Title}</dt>
            <dd>{t.emptySpec3Desc}</dd>
          </div>
        </dl>
      </div>
    </section>
  )
}
