import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Pause, Play, Scissors, X } from 'lucide-react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin, { type Region } from 'wavesurfer.js/dist/plugins/regions.esm.js'

interface AudioTrimmerProps {
  buffer: AudioBuffer
  fileName: string
  url: string
  onCancel: () => void
  onConfirm: (start: number, end: number) => void
}

const formatTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${(seconds - minutes * 60).toFixed(2).padStart(5, '0')}`
}

export function AudioTrimmer({ buffer, fileName, url, onCancel, onConfirm }: AudioTrimmerProps) {
  const waveformRef = useRef<HTMLDivElement>(null)
  const regionRef = useRef<Region | null>(null)
  const waveRef = useRef<WaveSurfer | null>(null)
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(buffer.duration)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)

  const stop = useCallback(() => {
    waveRef.current?.pause()
    setPlaying(false)
  }, [])

  useEffect(() => {
    if (!waveformRef.current) return
    const regions = RegionsPlugin.create()
    const wave = WaveSurfer.create({
      container: waveformRef.current,
      url,
      height: 164,
      waveColor: '#4a515b',
      progressColor: '#889d43',
      cursorColor: '#ffffff',
      cursorWidth: 1,
      barWidth: 2,
      barGap: 2,
      barRadius: 2,
      normalize: true,
      dragToSeek: true,
      plugins: [regions],
    })
    waveRef.current = wave
    wave.on('ready', () => {
      regionRef.current = regions.addRegion({
        start: 0,
        end: buffer.duration,
        color: 'rgba(216, 255, 85, 0.16)',
        drag: true,
        resize: true,
        minLength: Math.min(0.1, buffer.duration),
      })
    })
    regions.on('region-updated', (region) => {
      setStart(region.start)
      setEnd(region.end)
      wave.pause()
      wave.setTime(region.start)
      setCurrentTime(region.start)
      setPlaying(false)
    })
    wave.on('play', () => setPlaying(true))
    wave.on('pause', () => setPlaying(false))
    wave.on('timeupdate', (time) => setCurrentTime(time))
    wave.on('finish', () => {
      setPlaying(false)
      wave.setTime(regionRef.current?.start ?? 0)
    })

    return () => {
      wave.destroy()
      waveRef.current = null
    }
  }, [buffer, url])

  const setBoundary = (kind: 'start' | 'end', value: number) => {
    stop()
    const nextStart = kind === 'start' ? Math.min(value, end - 0.05) : start
    const nextEnd = kind === 'end' ? Math.max(value, start + 0.05) : end
    setStart(nextStart)
    setEnd(nextEnd)
    regionRef.current?.setOptions({ start: nextStart, end: nextEnd })
    waveRef.current?.setTime(nextStart)
    setCurrentTime(nextStart)
  }

  const togglePreview = useCallback(async () => {
    const wave = waveRef.current
    if (!wave) return
    if (wave.isPlaying()) {
      stop()
      return
    }
    if (wave.getCurrentTime() < start || wave.getCurrentTime() >= end) wave.setTime(start)
    await wave.play(undefined, end)
  }, [end, start, stop])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement | null
      if (event.code !== 'Space' || event.repeat || element?.matches('input, button, textarea, select')) return
      event.preventDefault()
      void togglePreview()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [togglePreview])

  const playbackProgress = Math.min(1, Math.max(0, (currentTime - start) / Math.max(0.001, end - start)))

  return (
    <div className="trimmer-backdrop" role="presentation">
      <section className="trimmer-dialog" role="dialog" aria-modal="true" aria-labelledby="trimmer-title">
        <div className="trimmer-header">
          <div className="trimmer-title"><span><Scissors size={19} /></span><div><h2 id="trimmer-title">Обрежьте аудио</h2><p>{fileName}</p></div></div>
          <button className="icon-button" onClick={onCancel} aria-label="Отменить"><X size={18} /></button>
        </div>

        <p className="trimmer-hint">Перетащите светлую область или её края. Для прослушивания нажмите <kbd>Пробел</kbd>.</p>
        <div className="trim-wave-shell"><div ref={waveformRef} /><div className={`trim-playhead ${playing ? 'is-playing' : ''}`} style={{ left: `${(currentTime / buffer.duration) * 100}%` }} /><div className="trim-time trim-time-start" style={{ left: `${(start / buffer.duration) * 100}%` }}>{formatTime(start)}</div><div className="trim-time trim-time-end" style={{ left: `${(end / buffer.duration) * 100}%` }}>{formatTime(end)}</div></div>

        <div className="trim-sliders">
          <label><span>Начало <output>{formatTime(start)}</output></span><input type="range" min="0" max={Math.max(0, end - 0.05)} step="0.001" value={start} onChange={(event) => setBoundary('start', Number(event.target.value))} /></label>
          <label><span>Конец <output>{formatTime(end)}</output></span><input type="range" min={Math.min(buffer.duration, start + 0.05)} max={buffer.duration} step="0.001" value={end} onChange={(event) => setBoundary('end', Number(event.target.value))} /></label>
        </div>

        <div className="trimmer-footer">
          <div className="trim-duration"><small>{playing ? 'ВОСПРОИЗВЕДЕНИЕ' : 'ДЛИТЕЛЬ ФРАГМЕНТА'}</small><strong>{playing ? `${formatTime(Math.max(0, currentTime - start))} / ${formatTime(end - start)}` : formatTime(end - start)}</strong><span><i style={{ width: `${playbackProgress * 100}%` }} /></span></div>
          <button className={`trim-preview ${playing ? 'playing' : ''}`} aria-keyshortcuts="Space" onClick={() => void togglePreview()}>{playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}{playing ? 'Остановить' : 'Прослушать'} <kbd>Space</kbd></button>
          <button className="trim-confirm" onClick={() => onConfirm(start, end)}><Check size={18} /> Использовать фрагмент</button>
        </div>
      </section>
    </div>
  )
}
