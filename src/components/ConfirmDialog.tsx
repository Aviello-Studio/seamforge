import { useEffect, useRef } from 'react'
import { AlertTriangle, X } from 'lucide-react'

export interface ConfirmDialogProps {
  title: string
  description: string
  detail?: string
  confirmLabel: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  description,
  detail,
  confirmLabel,
  cancelLabel = 'Отмена',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    confirmButtonRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault()
        onCancel()
      } else if (event.code === 'Enter' && !event.repeat) {
        const active = document.activeElement
        if (active && active.tagName === 'BUTTON' && active !== confirmButtonRef.current) return
        event.preventDefault()
        onConfirm()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel, onConfirm])

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <section
        className="confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-desc"
      >
        <header className="confirm-header">
          <div className="confirm-header-info">
            <span className={`confirm-icon ${danger ? 'is-danger' : ''}`} aria-hidden="true">
              <AlertTriangle size={16} strokeWidth={1.85} />
            </span>
            <h2 id="confirm-dialog-title">{title}</h2>
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--icon"
            onClick={onCancel}
            aria-label="Закрыть"
          >
            <X size={15} strokeWidth={1.85} aria-hidden="true" />
          </button>
        </header>

        <div className="confirm-body">
          <p id="confirm-dialog-desc" className="confirm-desc">
            {description}
          </p>
          {detail && <div className="confirm-detail">{detail}</div>}
        </div>

        <footer className="confirm-footer">
          <button type="button" className="btn btn--secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  )
}
