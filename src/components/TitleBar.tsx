import { useEffect, useState } from 'react'
import { Copy, FolderOpen, Globe, Minus, Square, Trash2, X } from 'lucide-react'
import appIcon from '../assets/app-icon.svg'
import {
  closeWindow,
  isWindowMaximized,
  minimizeWindow,
  toggleMaximizeWindow,
} from '../api/backend'
import type { AudioSummary } from '../api/types'
import {
  formatChannelLabel,
  formatSampleRateLocalized,
  LOCALES,
  type Locale,
  useI18n,
} from '../lib/i18n'

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
  const { locale, setLocale, t } = useI18n()
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

  const channelLabel = audio === null ? '' : formatChannelLabel(audio.channels, locale)

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-brand" title="SeamForge — Aviello Studio" data-tauri-drag-region>
        <img
          src={appIcon}
          alt=""
          className="titlebar-emblem"
          width={20}
          height={20}
          draggable={false}
          aria-hidden="true"
        />
        <span className="titlebar-wordmark" data-tauri-drag-region>
          SeamForge
        </span>
        {audio === null && (
          <span className="titlebar-studio" data-tauri-drag-region>
            by Aviello Studio
          </span>
        )}
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
              <span className="chip">{formatSampleRateLocalized(audio.sampleRate, locale)}</span>
              {audio.bitDepth !== null && (
                <span className="chip">{audio.bitDepth}-bit</span>
              )}
              <span className="chip">{channelLabel}</span>
            </div>
          </>
        )}
      </div>

      <div className="titlebar-actions">
        <div className="titlebar-lang" title={t.titlebarLangLabel}>
          <Globe size={13} strokeWidth={1.85} className="titlebar-lang-icon" aria-hidden="true" />
          <select
            className="titlebar-lang-select"
            aria-label={t.titlebarLangLabel}
            value={locale}
            onChange={(event) => setLocale(event.target.value as Locale)}
          >
            {LOCALES.map((opt) => (
              <option key={opt.code} value={opt.code}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {audio && (
          <button
            type="button"
            className="btn btn--ghost titlebar-clear-btn"
            onClick={onClearFile}
            disabled={disabled}
            title={t.titlebarClearTitle}
          >
            <Trash2 size={14} strokeWidth={1.85} aria-hidden="true" />
            <span>{t.titlebarClear}</span>
          </button>
        )}

        <button
          type="button"
          className="btn btn--ghost titlebar-open-btn"
          onClick={onOpenFile}
          disabled={disabled}
          title={t.titlebarOpenTitle}
        >
          <FolderOpen size={14} strokeWidth={1.85} aria-hidden="true" />
          <span>{t.titlebarOpen}</span>
        </button>

        <div className="titlebar-window-controls" role="group" aria-label={t.titlebarWindowControls}>
          <button
            type="button"
            className="win-btn"
            onClick={() => void minimizeWindow()}
            aria-label={t.titlebarMinimize}
            title={t.titlebarMinimize}
          >
            <Minus size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="win-btn"
            onClick={handleToggleMaximize}
            aria-label={isMaximized ? t.titlebarRestoreAria : t.titlebarMaximizeAria}
            title={isMaximized ? t.titlebarRestore : t.titlebarMaximize}
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
            aria-label={t.titlebarClose}
            title={t.titlebarClose}
          >
            <X size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  )
}
