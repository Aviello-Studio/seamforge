import { useEffect, useState } from 'react'
import { Copy, FolderOpen, Minus, Square, Trash2, X } from 'lucide-react'
import {
  closeWindow,
  isWindowMaximized,
  minimizeWindow,
  toggleMaximizeWindow,
} from '../api/backend'
import type { AudioSummary } from '../api/types'
import { formatSampleRate } from '../lib/format'

export interface TitleBarProps {
  audio: AudioSummary | null
  onOpenFile: () => void
  onClearFile: () => void
  disabled?: boolean
}

export function TitleBar({
  audio,
  onOpenFile,
  onClearFile,
  disabled = false,
}: TitleBarProps) {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    let active = true
    const syncMaximized = () => {
      void isWindowMaximized()
        .then((maximized) => {
          if (active) setIsMaximized(maximized)
        })
        .catch(() => undefined)
    }

    syncMaximized()
    window.addEventListener('resize', syncMaximized)
    return () => {
      active = false
      window.removeEventListener('resize', syncMaximized)
    }
  }, [])

  const handleToggleMaximize = () => {
    void toggleMaximizeWindow()
      .then((maximized) => setIsMaximized(maximized))
      .catch(() => undefined)
  }

  const channelLabel =
    audio === null
      ? ''
      : audio.channels === 1
        ? 'Моно'
        : audio.channels === 2
          ? 'Стерео'
          : `${audio.channels} кан.`

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-brand" data-tauri-drag-region>
        <svg
          className="titlebar-emblem"
          width="18"
          height="18"
          viewBox="0 0 18 18"
          fill="none"
          aria-hidden="true"
        >
          <rect
            x="1.25"
            y="1.25"
            width="15.5"
            height="15.5"
            rx="4"
            stroke="#363c47"
            strokeWidth="1.25"
            fill="#121417"
          />
          <path
            d="M4.2 10.6C5.2 6.8 6.8 5.2 9 9C11.2 12.8 12.8 11.2 13.8 7.4"
            stroke="#e59a3c"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
          <circle cx="9" cy="9" r="1.4" fill="#eceff4" />
        </svg>
        <span className="titlebar-wordmark" data-tauri-drag-region>
          SeamForge
        </span>
      </div>

      <div className="titlebar-meta" data-tauri-drag-region>
        {audio && (
          <>
            <span
              className="titlebar-filename"
              title={audio.fileName}
              data-tauri-drag-region
            >
              {audio.fileName}
            </span>
            <div className="titlebar-chips" data-tauri-drag-region>
              <span className="chip">{formatSampleRate(audio.sampleRate)}</span>
              {audio.bitDepth !== null && (
                <span className="chip">{audio.bitDepth}-bit</span>
              )}
              <span className="chip">{channelLabel}</span>
            </div>
          </>
        )}
      </div>

      <div className="titlebar-actions">
        {audio && (
          <button
            type="button"
            className="btn btn--ghost titlebar-clear-btn"
            onClick={onClearFile}
            disabled={disabled}
            title="Очистить проект и загрузить новый файл"
          >
            <Trash2 size={14} strokeWidth={1.85} aria-hidden="true" />
            <span>Очистить</span>
          </button>
        )}

        <button
          type="button"
          className="btn btn--ghost titlebar-open-btn"
          onClick={onOpenFile}
          disabled={disabled}
          title="Открыть аудио или видеофайл (Ctrl+O)"
        >
          <FolderOpen size={14} strokeWidth={1.85} aria-hidden="true" />
          <span>Открыть</span>
        </button>

        <div className="titlebar-window-controls" role="group" aria-label="Управление окном">
          <button
            type="button"
            className="win-btn"
            onClick={() => void minimizeWindow()}
            aria-label="Свернуть"
            title="Свернуть"
          >
            <Minus size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="win-btn"
            onClick={handleToggleMaximize}
            aria-label={isMaximized ? 'Восстановить окно' : 'Развернуть окно'}
            title={isMaximized ? 'Восстановить' : 'Развернуть'}
          >
            {isMaximized ? (
              <Copy size={12} strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <Square size={12} strokeWidth={1.75} aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            className="win-btn win-btn--close"
            onClick={() => void closeWindow()}
            aria-label="Закрыть"
            title="Закрыть"
          >
            <X size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  )
}
