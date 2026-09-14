import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, FileAudio, Pause, Play, RotateCcw, Sparkles, Upload, WandSparkles } from 'lucide-react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin, { type Region } from 'wavesurfer.js/dist/plugins/regions.esm.js'
import { AudioTrimmer } from './AudioTrimmer'
import { audioBufferAsLoop, encodeWav, renderSeamlessLoop, toAudioBuffer, trimAudioBuffer, type RenderedLoop } from './audio'
import { findMusicalLoops, type MusicalLoopCandidate } from './musicAnalysis'

type Status = 'empty' | 'decoding' | 'trimming' | 'ready' | 'analyzing' | 'rendering'
type PendingAudio = { buffer: AudioBuffer; fileName: string; url: string }

const formatTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${(seconds - minutes * 60).toFixed(2).padStart(5, '0')}`
}

function App() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const waveformRef = useRef<HTMLDivElement>(null)
  const waveRef = useRef<WaveSurfer | null>(null)
  const regionRef = useRef<Region | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const pendingUrlRef = useRef<string | null>(null)

  const [status, setStatus] = useState<Status>('empty')
  const [fileName, setFileName] = useState('')
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null)
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(0)
  const [crossfade, setCrossfade] = useState(80)
  const [quality, setQuality] = useState<number | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [message, setMessage] = useState('Перетащите аудиофайл, чтобы начать')
  const [waveformUrl, setWaveformUrl] = useState<string | null>(null)
  const [pendingAudio, setPendingAudio] = useState<PendingAudio | null>(null)
  const [loopCandidates, setLoopCandidates] = useState<MusicalLoopCandidate[]>([])
  const [selectedCandidate, setSelectedCandidate] = useState<number | null>(null)

  const duration = buffer?.duration ?? 0
  const loopDuration = Math.max(0, end - start - crossfade / 1000)

  const stopPreview = useCallback(() => {
    if (sourceRef.current) {
      try { sourceRef.current.stop() } catch { /* already stopped */ }
      sourceRef.current.disconnect()
      sourceRef.current = null
    }
    setIsPlaying(false)
  }, [])

  useEffect(() => () => {
    stopPreview()
    waveRef.current?.destroy()
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    if (pendingUrlRef.current) URL.revokeObjectURL(pendingUrlRef.current)
    void audioContextRef.current?.close()
  }, [stopPreview])

  const syncRegion = useCallback((nextStart: number, nextEnd: number) => {
    if (!regionRef.current) return
    regionRef.current.setOptions({ start: nextStart, end: nextEnd })
  }, [])

  const createWaveform = useCallback((url: string, length: number) => {
    waveRef.current?.destroy()
    if (!waveformRef.current) return
    const regions = RegionsPlugin.create()
    const wave = WaveSurfer.create({
      container: waveformRef.current,
      url,
      height: 210,
      waveColor: '#454b56',
      progressColor: '#d8ff55',
      cursorColor: '#ffffff',
      cursorWidth: 1,
      barWidth: 2,
      barGap: 2,
      barRadius: 2,
      normalize: true,
      dragToSeek: true,
      plugins: [regions],
    })
    wave.on('ready', () => {
      regionRef.current = regions.addRegion({
        start: 0,
        end: length,
        color: 'rgba(216, 255, 85, 0.10)',
        drag: false,
        resize: false,
      })
    })
    waveRef.current = wave
  }, [])

  useEffect(() => {
    if (buffer && waveformUrl && waveformRef.current) createWaveform(waveformUrl, buffer.duration)
  }, [buffer, waveformUrl, createWaveform])

  const loadFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('audio/') && !/\.(wav|mp3|m4a|aac|ogg|flac|opus)$/i.test(file.name)) {
      setMessage('Это не похоже на поддерживаемый аудиофайл')
      return
    }
    stopPreview()
    setStatus('decoding')
    setMessage('Декодирую аудио…')
    try {
      const context = audioContextRef.current ?? new AudioContext()
      audioContextRef.current = context
      const decoded = await context.decodeAudioData(await file.arrayBuffer())
      if (pendingUrlRef.current) URL.revokeObjectURL(pendingUrlRef.current)
      const url = URL.createObjectURL(file)
      pendingUrlRef.current = url
      setPendingAudio({ buffer: decoded, fileName: file.name, url })
      setStatus('trimming')
      setMessage('Выберите фрагмент перед загрузкой')
    } catch (error) {
      setStatus('empty')
      setMessage(error instanceof Error ? `Не удалось открыть файл: ${error.message}` : 'Не удалось открыть файл')
    }
  }, [stopPreview])

  const cancelTrim = () => {
    if (pendingUrlRef.current) URL.revokeObjectURL(pendingUrlRef.current)
    pendingUrlRef.current = null
    setPendingAudio(null)
    setStatus(buffer ? 'ready' : 'empty')
    setMessage(buffer ? 'Обрезка отменена — открыт предыдущий файл' : 'Перетащите аудиофайл, чтобы начать')
  }

  const confirmTrim = (trimStart: number, trimEnd: number) => {
    if (!pendingAudio) return
    const context = audioContextRef.current ?? new AudioContext()
    audioContextRef.current = context
    const trimmed = trimAudioBuffer(context, pendingAudio.buffer, trimStart, trimEnd)
    const bytes = encodeWav(audioBufferAsLoop(trimmed))
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    if (pendingUrlRef.current) URL.revokeObjectURL(pendingUrlRef.current)
    pendingUrlRef.current = null
    objectUrlRef.current = url
    setWaveformUrl(url)
    setBuffer(trimmed)
    setFileName(pendingAudio.fileName)
    setStart(0)
    setEnd(trimmed.duration)
    setQuality(null)
    setLoopCandidates([])
    setSelectedCandidate(null)
    setPendingAudio(null)
    setStatus('ready')
    setMessage(`${trimmed.numberOfChannels === 1 ? 'Моно' : 'Стерео'} · ${Math.round(trimmed.sampleRate / 1000)} кГц · обрезано до ${formatTime(trimmed.duration)}`)
  }

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault()
    const file = event.dataTransfer.files[0]
    if (file) void loadFile(file)
  }

  const autoFind = async () => {
    if (!buffer) return
    stopPreview()
    setStatus('analyzing')
    setMessage('Готовлю музыкальный анализ…')
    await new Promise((resolve) => window.setTimeout(resolve, 30))
    try {
      const results = await findMusicalLoops(buffer, (progress, stage) =>
        setMessage(`${stage} · ${Math.round(progress * 100)}%`),
      )
      setLoopCandidates(results)
      applyCandidate(results[0], 0)
      setMessage(`Найдено вариантов: ${results.length}. Прослушайте стык и выберите лучший.`)
    } catch (error) {
      setMessage(error instanceof Error ? `Ошибка музыкального анализа: ${error.message}` : 'Музыкальный анализ не удался')
    } finally {
      setStatus('ready')
    }
  }

  const applyCandidate = (candidate: MusicalLoopCandidate, index: number) => {
    stopPreview()
    setStart(candidate.start)
    setEnd(candidate.end)
    setCrossfade(candidate.crossfadeMs)
    setQuality(candidate.score)
    setSelectedCandidate(index)
    syncRegion(candidate.start, candidate.end)
  }

  const rendered = useMemo<RenderedLoop | null>(() => {
    if (!buffer || end <= start) return null
    return renderSeamlessLoop(buffer, start, end, crossfade)
  }, [buffer, start, end, crossfade])

  const togglePreview = async () => {
    if (isPlaying) {
      stopPreview()
      return
    }
    if (!rendered) return
    const context = audioContextRef.current ?? new AudioContext()
    audioContextRef.current = context
    if (context.state === 'suspended') await context.resume()
    const source = context.createBufferSource()
    source.buffer = toAudioBuffer(context, rendered)
    source.loop = true
    source.connect(context.destination)
    source.onended = () => {
      if (sourceRef.current === source) sourceRef.current = null
      setIsPlaying(false)
    }
    source.start(0, Math.max(0, rendered.duration - Math.min(3, rendered.duration * 0.35)))
    sourceRef.current = source
    setIsPlaying(true)
    setMessage('Стык прозвучит через несколько секунд — играет обработанный результат')
  }

  const exportLoop = async () => {
    if (!rendered) return
    setStatus('rendering')
    stopPreview()
    try {
      const bytes = encodeWav(rendered)
      const outputName = `${fileName.replace(/\.[^.]+$/, '') || 'loop'}-seamless.wav`
      if (window.seamforge) {
        const path = await window.seamforge.saveWav(bytes, outputName)
        setMessage(path ? `Сохранено: ${path}` : 'Сохранение отменено')
      } else {
        const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = outputName
        anchor.click()
        URL.revokeObjectURL(url)
        setMessage(`Экспортирован ${outputName}`)
      }
    } finally {
      setStatus('ready')
    }
  }

  const updateStart = (value: number) => {
    const next = Math.min(value, end - 0.1)
    setStart(next)
    setQuality(null)
    setSelectedCandidate(null)
    syncRegion(next, end)
    stopPreview()
  }

  const updateEnd = (value: number) => {
    const next = Math.max(value, start + 0.1)
    setEnd(next)
    setQuality(null)
    setSelectedCandidate(null)
    syncRegion(start, next)
    stopPreview()
  }

  return (
    <main onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><RotateCcw size={16} /></span> SeamForge</div>
        <div className="local-badge"><span /> Обработка на устройстве</div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow"><Sparkles size={14} /> SEAMLESS LOOP STUDIO</p>
          <h1>Заставьте звук<br /><em>замкнуться идеально.</em></h1>
          <p className="subtitle">Находим похожие фрагменты сигнала, совмещаем zero crossing и сглаживаем стык корреляционно-безопасным crossfade без скачка громкости.</p>
        </div>
        <div className="hero-orbit" aria-hidden="true"><div /><div /><span>∞</span></div>
      </section>

      <section className={`workspace ${!buffer ? 'is-empty' : ''}`}>
        {!buffer ? (
          <button className="dropzone" onClick={() => fileInputRef.current?.click()}>
            <span className="upload-icon"><Upload size={25} /></span>
            <strong>Перетащите аудио сюда</strong>
            <small>или нажмите, чтобы выбрать · WAV, MP3, FLAC, M4A, OGG</small>
          </button>
        ) : (
          <>
            <div className="file-row">
              <div className="file-meta"><span className="file-icon"><FileAudio size={20} /></span><div><strong>{fileName}</strong><small>{message}</small></div></div>
              <button className="text-button" onClick={() => fileInputRef.current?.click()}>Заменить</button>
            </div>
            <div className="wave-shell"><div ref={waveformRef} className="waveform" /><div className="wave-label start-label" style={{ left: `${(start / duration) * 100}%` }}>{formatTime(start)}</div><div className="wave-label end-label" style={{ left: `${(end / duration) * 100}%` }}>{formatTime(end)}</div></div>
            <div className="controls-grid">
              <label><span><b>Начало</b><output>{formatTime(start)}</output></span><input type="range" min="0" max={Math.max(0, duration - 0.1)} step="0.001" value={start} onChange={(event) => updateStart(Number(event.target.value))} /></label>
              <label><span><b>Конец</b><output>{formatTime(end)}</output></span><input type="range" min="0.1" max={duration} step="0.001" value={end} onChange={(event) => updateEnd(Number(event.target.value))} /></label>
              <label><span><b>Crossfade</b><output>{crossfade} мс</output></span><input type="range" min="5" max={Math.min(1000, Math.max(20, loopDuration * 450))} step="5" value={crossfade} onChange={(event) => { setCrossfade(Number(event.target.value)); stopPreview() }} /></label>
            </div>
            {loopCandidates.length > 0 && <div className="candidate-strip"><div><strong>Музыкальные варианты</strong><small>От beat/chroma-анализа, лучший не всегда первый</small></div><div className="candidate-list">{loopCandidates.map((candidate, index) => <button key={`${candidate.start}-${candidate.end}`} className={selectedCandidate === index ? 'selected' : ''} onClick={() => applyCandidate(candidate, index)}><b>#{index + 1}</b><span>{formatTime(candidate.start)} → {formatTime(candidate.end)}</span><em>{candidate.confidence}%</em></button>)}</div></div>}
            <div className="action-row">
              <button className="magic-button" onClick={() => void autoFind()} disabled={status !== 'ready'}><WandSparkles size={18} /> {status === 'analyzing' ? 'Анализирую музыку…' : 'Найти музыкальный стык'}</button>
              <button className={`play-button ${isPlaying ? 'playing' : ''}`} onClick={() => void togglePreview()} disabled={!rendered}>{isPlaying ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />} {isPlaying ? 'Остановить' : 'Проверить стык'}</button>
              <div className="spacer" />
              {quality !== null && <div className="score"><span style={{ width: `${Math.max(8, 100 - quality * 45)}%` }} /> Сходство стыка</div>}
              <button className="export-button" onClick={() => void exportLoop()} disabled={!rendered || status !== 'ready'}><Download size={18} /> Экспорт WAV</button>
            </div>
          </>
        )}
        <input ref={fileInputRef} type="file" accept="audio/*,.flac,.m4a,.opus" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void loadFile(file) }} />
      </section>

      {pendingAudio && <AudioTrimmer buffer={pendingAudio.buffer} fileName={pendingAudio.fileName} url={pendingAudio.url} onCancel={cancelTrim} onConfirm={confirmTrim} />}

      <footer><span>{buffer ? `Готовая петля: ${formatTime(loopDuration)}` : message}</span><span>Никаких загрузок в облако</span></footer>
    </main>
  )
}

export default App
