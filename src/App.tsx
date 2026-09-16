import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Cpu, Download, FileAudio, Gauge, Pause, Play, RotateCcw, Settings, Sparkles, Upload, WandSparkles, X } from 'lucide-react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin, { type Region } from 'wavesurfer.js/dist/plugins/regions.esm.js'
import { AudioTrimmer } from './AudioTrimmer'
import { applyCircularInpaint, audioBufferAsLoop, circularInpaintCost, encodeWav, prepareCircularInpaint, renderSeamlessLoop, toAudioBuffer, trimAudioBuffer, type RenderedLoop } from './audio'
import { findMusicalLoops, type MusicalLoopCandidate } from './musicAnalysis'

type Status = 'empty' | 'decoding' | 'trimming' | 'ready' | 'analyzing' | 'rendering'
type PendingAudio = { buffer: AudioBuffer; fileName: string; url: string }
type ProcessingDevice = 'cpu' | 'cuda'

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
  const animationFrameRef = useRef<number | null>(null)
  const isPlayingRef = useRef(false)
  const seekPreviewRef = useRef<(time: number) => void>(() => undefined)
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
  const [playhead, setPlayhead] = useState(0)
  const [aiEnabled, setAiEnabled] = useState(false)
  const [aiRuntimeLabel, setAiRuntimeLabel] = useState('Установится при первом анализе')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [processingDevice, setProcessingDevice] = useState<ProcessingDevice>('cpu')
  const [settingsDraft, setSettingsDraft] = useState<ProcessingDevice>('cpu')
  const [gpuInfo, setGpuInfo] = useState<{ available: boolean; name: string | null }>({ available: false, name: null })
  const [generatedLoop, setGeneratedLoop] = useState<RenderedLoop | null>(null)

  const duration = buffer?.duration ?? 0
  const loopDuration = Math.max(0, end - start - crossfade / 1000)

  const stopPreview = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    if (sourceRef.current) {
      try { sourceRef.current.stop() } catch { /* already stopped */ }
      sourceRef.current.disconnect()
      sourceRef.current = null
    }
    isPlayingRef.current = false
    setIsPlaying(false)
  }, [])

  useEffect(() => () => {
    stopPreview()
    waveRef.current?.destroy()
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    if (pendingUrlRef.current) URL.revokeObjectURL(pendingUrlRef.current)
    void audioContextRef.current?.close()
  }, [stopPreview])

  useEffect(() => {
    if (!window.seamforge) return
    void window.seamforge.aiStatus().then((state) => setAiRuntimeLabel(state.label))
    void window.seamforge.getSettings().then((settings) => {
      setProcessingDevice(settings.processingDevice)
      setSettingsDraft(settings.processingDevice)
      setGpuInfo(settings.gpu)
    })
    return window.seamforge.onAiProgress((progress) => setMessage(progress))
  }, [])

  const saveProcessingSettings = async () => {
    if (!window.seamforge) return
    const settings = await window.seamforge.saveSettings({ processingDevice: settingsDraft })
    setProcessingDevice(settings.processingDevice)
    const runtime = await window.seamforge.aiStatus()
    setAiRuntimeLabel(runtime.label)
    setSettingsOpen(false)
    setMessage(`Обработка: ${settings.processingDevice === 'cuda' ? `GPU · ${gpuInfo.name ?? 'NVIDIA CUDA'}` : 'CPU'}. Применится при следующем ИИ‑анализе.`)
  }

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
    wave.on('interaction', (time) => seekPreviewRef.current(time))
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
    setGeneratedLoop(null)
    setPlayhead(0)
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
      let vocalBuffer: AudioBuffer | undefined
      if (aiEnabled) {
        if (!window.seamforge) throw new Error('ИИ‑режим доступен в настольной версии SeamForge')
        const wav = encodeWav(audioBufferAsLoop(buffer))
        const separation = await window.seamforge.separateVocals(wav)
        if (!separation.ok) throw new Error(separation.error)
        const context = audioContextRef.current ?? new AudioContext()
        audioContextRef.current = context
        const bytes = separation.vocals
        const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
        vocalBuffer = await context.decodeAudioData(copy)
        setAiRuntimeLabel('ИИ‑движок готов')
      }
      const results = await findMusicalLoops(buffer, (progress, stage) =>
        setMessage(`${stage} · ${Math.round(progress * 100)}%`),
      { vocalBuffer, exhaustive: aiEnabled })
      setLoopCandidates(results)
      applyCandidate(results[0], 0)
      const best = results[0]
      if (aiEnabled && best.confidence < 96 && window.seamforge) {
        const bridgeSeconds = Math.min(1.1, Math.max(0.55, 0.55 + (96 - best.confidence) * 0.025))
        const plan = prepareCircularInpaint(buffer, best.start, best.end, bridgeSeconds)
        if (plan) {
          try {
            setMessage('Стык ниже 96% — создаю двусторонний ИИ‑мост…')
            const response = await window.seamforge.generateBridges(
              encodeWav(plan.input), plan.maskStart, plan.maskEnd, plan.input.duration,
            )
            if (!response.ok) throw new Error(response.error)
            const context = audioContextRef.current ?? new AudioContext()
            audioContextRef.current = context
            const generatedCandidates: RenderedLoop[] = []
            for (const bytes of response.bridges) {
              const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
              const generated = await context.decodeAudioData(copy)
              generatedCandidates.push(applyCircularInpaint(
                buffer, best.start, best.end, generated, plan.maskStart, plan.bridgeSeconds,
              ))
            }
            generatedCandidates.sort((a, b) => circularInpaintCost(a, plan.bridgeSeconds) - circularInpaintCost(b, plan.bridgeSeconds))
            setGeneratedLoop(generatedCandidates[0] ?? null)
            setMessage(`AI Bridge готов: естественный стык был ${best.confidence}%, переход дорисован с двух сторон. Прослушайте результат.`)
          } catch (bridgeError) {
            setGeneratedLoop(null)
            const reason = bridgeError instanceof Error ? bridgeError.message : 'неизвестная ошибка'
            setMessage(`Найден естественный стык ${best.confidence}%. ИИ‑мост недоступен: ${reason}`)
          }
        } else {
          setMessage(`ИИ‑анализ нашёл ${results.length} вариантов. Фрагмент слишком короткий для безопасной догенерации.`)
        }
      } else {
        setMessage(best.confidence >= 96 && aiEnabled
          ? `Стык ${best.confidence}% уже неотличим на слух — генерация не потребовалась.`
          : `${aiEnabled ? 'ИИ‑анализ' : 'Fast Pro'} нашёл вариантов: ${results.length}. Прослушайте стык и выберите лучший.`)
      }
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
    setGeneratedLoop(null)
    syncRegion(candidate.start, candidate.end)
    const auditionPoint = Math.max(candidate.start, candidate.end - Math.min(3, (candidate.end - candidate.start) * 0.35))
    setPlayhead(auditionPoint)
    waveRef.current?.setTime(auditionPoint)
  }

  const rendered = useMemo<RenderedLoop | null>(() => {
    if (generatedLoop) return generatedLoop
    if (!buffer || end <= start) return null
    return renderSeamlessLoop(buffer, start, end, crossfade)
  }, [buffer, start, end, crossfade, generatedLoop])

  const renderedRef = useRef<RenderedLoop | null>(null)
  const loopBoundsRef = useRef({ start: 0, end: 0 })
  renderedRef.current = rendered
  loopBoundsRef.current = { start, end }

  const startPreviewAt = useCallback(async (requestedOffset: number) => {
    const currentLoop = renderedRef.current
    if (!currentLoop) return
    stopPreview()
    const context = audioContextRef.current ?? new AudioContext()
    audioContextRef.current = context
    if (context.state === 'suspended') await context.resume()
    const offset = ((requestedOffset % currentLoop.duration) + currentLoop.duration) % currentLoop.duration
    const source = context.createBufferSource()
    source.buffer = toAudioBuffer(context, currentLoop)
    source.loop = true
    source.connect(context.destination)
    source.start(0, offset)
    sourceRef.current = source
    isPlayingRef.current = true
    setIsPlaying(true)
    const startedAt = context.currentTime
    const tick = () => {
      if (sourceRef.current !== source) return
      const bounds = loopBoundsRef.current
      const elapsed = (offset + context.currentTime - startedAt) % currentLoop.duration
      const visibleTime = bounds.start + elapsed / currentLoop.duration * Math.max(0, bounds.end - bounds.start)
      setPlayhead(visibleTime)
      waveRef.current?.setTime(visibleTime)
      animationFrameRef.current = requestAnimationFrame(tick)
    }
    tick()
  }, [stopPreview])

  const seekPreview = useCallback((requestedTime: number) => {
    const currentLoop = renderedRef.current
    if (!currentLoop) return
    const bounds = loopBoundsRef.current
    const time = Math.min(bounds.end, Math.max(bounds.start, requestedTime))
    const ratio = (time - bounds.start) / Math.max(0.001, bounds.end - bounds.start)
    const offset = Math.min(currentLoop.duration - 0.001, Math.max(0, ratio * currentLoop.duration))
    const wasPlaying = isPlayingRef.current
    setPlayhead(time)
    waveRef.current?.setTime(time)
    if (wasPlaying) void startPreviewAt(offset)
  }, [startPreviewAt])

  useEffect(() => {
    seekPreviewRef.current = seekPreview
  }, [seekPreview])

  const togglePreview = async () => {
    if (isPlaying) {
      stopPreview()
      return
    }
    if (!rendered) return
    const previewTime = playhead >= start && playhead < end
      ? playhead
      : Math.max(start, end - Math.min(3, (end - start) * 0.35))
    const offset = (previewTime - start) / Math.max(0.001, end - start) * rendered.duration
    await startPreviewAt(offset)
    setMessage('Играет обработанный loop — перематывайте курсором на волне или ползунком')
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
    setGeneratedLoop(null)
    syncRegion(next, end)
    setPlayhead((current) => Math.max(next, Math.min(end, current)))
    stopPreview()
  }

  const updateEnd = (value: number) => {
    const next = Math.max(value, start + 0.1)
    setEnd(next)
    setQuality(null)
    setSelectedCandidate(null)
    setGeneratedLoop(null)
    syncRegion(start, next)
    setPlayhead((current) => Math.max(start, Math.min(next, current)))
    stopPreview()
  }

  return (
    <main onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><RotateCcw size={16} /></span> SeamForge</div>
        <div className="topbar-actions"><div className="local-badge"><span /> Обработка на устройстве</div><button className="settings-button" aria-label="Настройки" onClick={() => { setSettingsDraft(processingDevice); setSettingsOpen(true) }}><Settings size={17} /></button></div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow"><Sparkles size={14} /> SEAMLESS LOOP STUDIO</p>
          <h1>Заставьте звук<br /><em>замкнуться идеально.</em></h1>
          <p className="subtitle">Fast Pro сопоставляет повторяющиеся музыкальные фразы, границы тактов и фазу каждого канала, а затем сглаживает стык без скачка громкости.</p>
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
            <label className="preview-scrubber"><span>{isPlaying ? 'Воспроизводится' : 'Позиция'} · {formatTime(playhead)}</span><input aria-label="Позиция воспроизведения" type="range" min={start} max={Math.max(start + 0.001, end)} step="0.001" value={Math.max(start, Math.min(end, playhead))} onChange={(event) => seekPreview(Number(event.target.value))} /><output>{formatTime(end)}</output></label>
            <div className="controls-grid">
              <label><span><b>Начало</b><output>{formatTime(start)}</output></span><input type="range" min="0" max={Math.max(0, duration - 0.1)} step="0.001" value={start} onChange={(event) => updateStart(Number(event.target.value))} /></label>
              <label><span><b>Конец</b><output>{formatTime(end)}</output></span><input type="range" min="0.1" max={duration} step="0.001" value={end} onChange={(event) => updateEnd(Number(event.target.value))} /></label>
              <label><span><b>Crossfade</b><output>{crossfade} мс</output></span><input type="range" min="5" max={Math.min(1000, Math.max(20, loopDuration * 450))} step="5" value={crossfade} onChange={(event) => { setCrossfade(Number(event.target.value)); setGeneratedLoop(null); stopPreview() }} /></label>
            </div>
            <div className={`ai-mode ${aiEnabled ? 'enabled' : ''}`}>
              <label className="ai-switch">
                <input type="checkbox" checked={aiEnabled} disabled={status === 'analyzing'} onChange={(event) => {
                  setAiEnabled(event.target.checked)
                  setLoopCandidates([])
                  setSelectedCandidate(null)
                  setGeneratedLoop(null)
                  setQuality(null)
                  setMessage(event.target.checked ? 'ИИ‑режим включён — глубокий анализ запустится по кнопке' : 'ИИ‑режим выключен — используется быстрый локальный анализ')
                }} />
                <span aria-hidden="true" />
                <div><strong>Включить ИИ‑режим</strong><small>BS‑RoFormer защищает вокал, AI Bridge дорисует только сложный стык ниже 96%</small></div>
              </label>
              <em>{aiEnabled ? aiRuntimeLabel : 'Fast Pro без модели'}</em>
            </div>
            {loopCandidates.length > 0 && <div className="candidate-strip"><div><strong>{loopCandidates[0]?.label.startsWith('AI') ? 'AI Studio варианты' : 'Fast Pro варианты'}</strong><small>{loopCandidates[0]?.diagnostics?.vocal === undefined ? 'Такт · recurrence · стереофаза' : 'Вокал · такт · фраза · стереофаза'}; процент — индекс уверенности</small></div><div className="candidate-list">{loopCandidates.map((candidate, index) => <button key={`${candidate.start}-${candidate.end}`} title={candidate.diagnostics ? `Музыка ${Math.round(candidate.diagnostics.musical * 100)} · фраза ${Math.round(candidate.diagnostics.recurrence * 100)} · ритм ${Math.round(candidate.diagnostics.rhythm * 100)} · фаза ${Math.round(candidate.diagnostics.phase * 100)}${candidate.diagnostics.vocal === undefined ? '' : ` · безопасность вокала ${Math.round(candidate.diagnostics.vocal * 100)}`}` : candidate.label} className={selectedCandidate === index ? 'selected' : ''} onClick={() => applyCandidate(candidate, index)}><b>#{index + 1}</b><span>{formatTime(candidate.start)} → {formatTime(candidate.end)}</span><em>{candidate.confidence}%</em></button>)}</div></div>}
            <div className="action-row">
              <button className="magic-button" onClick={() => void autoFind()} disabled={status !== 'ready'}><WandSparkles size={18} /> {status === 'analyzing' ? (aiEnabled ? 'ИИ анализирует…' : 'Анализирую музыку…') : (aiEnabled ? 'Найти идеальный стык с ИИ' : 'Найти музыкальный стык')}</button>
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

      {settingsOpen && <div className="settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false) }}>
        <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
          <header><div><p>SEAMFORGE</p><h2 id="settings-title">Настройки обработки</h2></div><button className="icon-button" aria-label="Закрыть настройки" onClick={() => setSettingsOpen(false)}><X size={18} /></button></header>
          <div className="settings-body">
            <div className="settings-heading"><strong>Устройство для ИИ</strong><small>Выбор влияет только на отделение вокала. Fast Pro работает одинаково.</small></div>
            <label className={`device-card ${settingsDraft === 'cpu' ? 'selected' : ''}`}>
              <input type="radio" name="processing-device" value="cpu" checked={settingsDraft === 'cpu'} onChange={() => setSettingsDraft('cpu')} />
              <span><Cpu size={20} /></span><div><strong>Процессор · CPU</strong><small>Надёжный режим, медленнее, не использует видеопамять</small></div><em>Всегда доступен</em>
            </label>
            <label className={`device-card ${settingsDraft === 'cuda' ? 'selected' : ''} ${!gpuInfo.available ? 'disabled' : ''}`}>
              <input type="radio" name="processing-device" value="cuda" checked={settingsDraft === 'cuda'} disabled={!gpuInfo.available} onChange={() => setSettingsDraft('cuda')} />
              <span><Gauge size={20} /></span><div><strong>Видеокарта · NVIDIA CUDA</strong><small>{gpuInfo.name ?? 'Совместимая NVIDIA GPU не найдена'}</small></div><em>{gpuInfo.available ? 'Значительно быстрее' : 'Недоступно'}</em>
            </label>
            {settingsDraft === 'cuda' && <p className="gpu-note">При первом GPU‑анализе SeamForge один раз загрузит CUDA‑сборку PyTorch. Потребуется дополнительное место на диске.</p>}
          </div>
          <footer><button onClick={() => setSettingsOpen(false)}>Отмена</button><button className="settings-save" onClick={() => void saveProcessingSettings()}>Сохранить настройки</button></footer>
        </section>
      </div>}

      <footer><span>{buffer ? `Готовая петля: ${formatTime(loopDuration)}` : message}</span><span>Никаких загрузок в облако</span></footer>
    </main>
  )
}

export default App
