export interface LoopPoints {
  start: number
  end: number
  score: number
}

export interface RenderedLoop {
  channels: Float32Array<ArrayBuffer>[]
  sampleRate: number
  duration: number
}

export interface CircularInpaintPlan {
  input: RenderedLoop
  maskStart: number
  maskEnd: number
  bridgeSeconds: number
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function mixToMono(buffer: AudioBuffer): Float32Array {
  const mono = new Float32Array(buffer.length)
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < data.length; i += 1) mono[i] += data[i] / buffer.numberOfChannels
  }
  return mono
}

function candidateCrossings(data: Float32Array, from: number, to: number, limit = 72): number[] {
  const candidates: Array<{ index: number; value: number }> = []
  const safeFrom = clamp(Math.floor(from), 1, data.length - 2)
  const safeTo = clamp(Math.ceil(to), safeFrom + 1, data.length - 1)
  const stride = Math.max(1, Math.floor((safeTo - safeFrom) / 12_000))

  for (let i = safeFrom; i < safeTo; i += stride) {
    const crossed = (data[i - 1] <= 0 && data[i] >= 0) || (data[i - 1] >= 0 && data[i] <= 0)
    if (crossed) candidates.push({ index: i, value: Math.abs(data[i]) + Math.abs(data[i] - data[i - 1]) * 0.08 })
  }

  return candidates.sort((a, b) => a.value - b.value).slice(0, limit).map((item) => item.index)
}

function seamCost(data: Float32Array, start: number, end: number, window: number): number {
  let dot = 0
  let energyA = 0
  let energyB = 0
  const stride = Math.max(1, Math.floor(window / 192))
  let count = 0
  for (let offset = 0; offset < window; offset += stride) {
    const a = data[end - window + offset]
    const b = data[start + offset]
    dot += a * b
    energyA += a * a
    energyB += b * b
    count += 1
  }
  const rmsA = Math.sqrt(energyA / Math.max(1, count))
  const rmsB = Math.sqrt(energyB / Math.max(1, count))
  const correlation = dot / (Math.sqrt(energyA * energyB) + 1e-9)
  const shapeError = 1 - clamp(correlation, -1, 1)
  const loudnessError = Math.abs(rmsA - rmsB) / (Math.max(rmsA, rmsB) + 0.015)
  const scale = Math.max(rmsA, rmsB) + 0.015
  const boundaryError = Math.abs(data[end - 1] - data[start]) / scale
  const slopeError = Math.abs((data[end - 1] - data[end - 2]) - (data[start + 1] - data[start])) / scale
  return shapeError * 0.58 + loudnessError * 0.2 + boundaryError * 0.14 + slopeError * 0.08
}

export function findBestLoop(data: Float32Array, sampleRate: number): LoopPoints {
  if (data.length < sampleRate * 0.25) return { start: 0, end: data.length, score: 0 }

  const edgeWindow = Math.min(Math.floor(sampleRate * 1.5), Math.floor(data.length * 0.1))
  const starts = candidateCrossings(data, 0, edgeWindow)
  const ends = candidateCrossings(data, data.length - edgeWindow, data.length - 1)
  if (starts.length === 0 || ends.length === 0) return { start: 0, end: data.length, score: 1 }
  const analysisWindow = Math.max(16, Math.min(Math.floor(sampleRate * 0.08), Math.floor(data.length * 0.04)))
  let best: LoopPoints = { start: 0, end: data.length, score: Number.POSITIVE_INFINITY }

  for (const start of starts) {
    for (const end of ends) {
      if (end - start < sampleRate * 0.2) continue
      if (end - start <= analysisWindow * 2) continue
      const trimPenalty = ((start + data.length - end) / Math.max(1, edgeWindow)) * 0.06
      const cost = seamCost(data, start, end, analysisWindow) + trimPenalty
      if (cost < best.score) best = { start, end, score: cost }
    }
  }

  return best
}

export function renderSeamlessLoop(
  buffer: AudioBuffer,
  startSeconds: number,
  endSeconds: number,
  crossfadeMs: number,
): RenderedLoop {
  const rate = buffer.sampleRate
  const start = clamp(Math.round(startSeconds * rate), 0, buffer.length - 2)
  const end = clamp(Math.round(endSeconds * rate), start + 2, buffer.length)
  const length = end - start
  const fade = clamp(Math.round((crossfadeMs / 1000) * rate), 1, Math.max(1, Math.floor(length * 0.45)))
  const outputLength = length - fade
  const bodyLength = length - fade * 2
  const channels: Float32Array<ArrayBuffer>[] = []

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const source = buffer.getChannelData(channel)
    const output = new Float32Array(outputLength)
    if (bodyLength > 0) output.set(source.subarray(start + fade, end - fade), 0)

    const mixOffset = Math.max(0, bodyLength)
    for (let i = 0; i < fade; i += 1) {
      const t = fade === 1 ? 1 : i / (fade - 1)
      const fadeIn = 0.5 - Math.cos(t * Math.PI) * 0.5
      const fadeOut = 1 - fadeIn
      output[mixOffset + i] = source[end - fade + i] * fadeOut + source[start + i] * fadeIn
    }
    channels.push(output)
  }

  return { channels, sampleRate: rate, duration: outputLength / rate }
}

export function toAudioBuffer(context: BaseAudioContext, loop: RenderedLoop): AudioBuffer {
  const buffer = context.createBuffer(loop.channels.length, loop.channels[0].length, loop.sampleRate)
  loop.channels.forEach((channel, index) => buffer.copyToChannel(channel, index))
  return buffer
}

export function trimAudioBuffer(
  context: BaseAudioContext,
  buffer: AudioBuffer,
  startSeconds: number,
  endSeconds: number,
): AudioBuffer {
  const start = clamp(Math.round(startSeconds * buffer.sampleRate), 0, buffer.length - 1)
  const end = clamp(Math.round(endSeconds * buffer.sampleRate), start + 1, buffer.length)
  const trimmed = context.createBuffer(buffer.numberOfChannels, end - start, buffer.sampleRate)
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    trimmed.copyToChannel(buffer.getChannelData(channel).subarray(start, end), channel)
  }
  return trimmed
}

export function audioBufferAsLoop(buffer: AudioBuffer): RenderedLoop {
  return {
    channels: Array.from({ length: buffer.numberOfChannels }, (_, channel) =>
      new Float32Array(buffer.getChannelData(channel)),
    ),
    sampleRate: buffer.sampleRate,
    duration: buffer.duration,
  }
}

/**
 * Places the old loop boundary in the middle of a context clip. The generator
 * therefore sees music on both sides of the missing span instead of guessing a
 * one-sided continuation from the end of the song.
 */
export function prepareCircularInpaint(
  buffer: AudioBuffer,
  startSeconds: number,
  endSeconds: number,
  requestedBridgeSeconds = 0.8,
): CircularInpaintPlan | null {
  const rate = buffer.sampleRate
  const start = clamp(Math.round(startSeconds * rate), 0, buffer.length - 2)
  const end = clamp(Math.round(endSeconds * rate), start + 2, buffer.length)
  const loopLength = end - start
  if (loopLength < rate * 4) return null

  const bridge = clamp(Math.round(requestedBridgeSeconds * rate), Math.round(rate * 0.35), Math.round(rate * 1.2))
  const half = Math.floor(bridge / 2)
  const bodyStart = start + half
  const bodyEnd = end - (bridge - half)
  if (bodyEnd - bodyStart < rate * 3) return null
  const context = Math.min(Math.round(rate * 9.6), bodyEnd - bodyStart)
  const total = context * 2 + bridge
  const channels: Float32Array<ArrayBuffer>[] = []

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const source = buffer.getChannelData(channel)
    const input = new Float32Array(total)
    input.set(source.subarray(bodyEnd - context, bodyEnd), 0)
    // The bridge stays zeroed; Stable Audio receives the exact mask separately.
    input.set(source.subarray(bodyStart, bodyStart + context), context + bridge)
    channels.push(input)
  }

  return {
    input: { channels, sampleRate: rate, duration: total / rate },
    maskStart: context / rate,
    maskEnd: (context + bridge) / rate,
    bridgeSeconds: bridge / rate,
  }
}

/** Replaces equal halves around the old boundary with the generated bridge. */
export function applyCircularInpaint(
  buffer: AudioBuffer,
  startSeconds: number,
  endSeconds: number,
  generated: AudioBuffer,
  maskStartSeconds: number,
  bridgeSeconds: number,
): RenderedLoop {
  const rate = buffer.sampleRate
  const start = clamp(Math.round(startSeconds * rate), 0, buffer.length - 2)
  const end = clamp(Math.round(endSeconds * rate), start + 2, buffer.length)
  const bridge = clamp(Math.round(bridgeSeconds * rate), 1, end - start - 2)
  const half = Math.floor(bridge / 2)
  const bodyStart = start + half
  const bodyEnd = end - (bridge - half)
  const generatedStart = Math.round(maskStartSeconds * generated.sampleRate)
  const generatedLength = Math.round(bridgeSeconds * generated.sampleRate)
  const outputLength = bodyEnd - bodyStart + bridge
  const edge = Math.max(1, Math.min(Math.round(rate * 0.035), Math.floor(bridge / 5), bodyEnd - bodyStart))
  const channels: Float32Array<ArrayBuffer>[] = []

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const source = buffer.getChannelData(channel)
    const generatedChannel = generated.getChannelData(Math.min(channel, generated.numberOfChannels - 1))
    const output = new Float32Array(outputLength)
    output.set(source.subarray(bodyStart, bodyEnd), 0)
    const bridgeOffset = bodyEnd - bodyStart
    for (let i = 0; i < bridge; i += 1) {
      const sourceIndex = generatedStart + Math.min(generatedLength - 1, Math.floor(i * generatedLength / bridge))
      output[bridgeOffset + i] = generatedChannel[clamp(sourceIndex, 0, generatedChannel.length - 1)]
    }
    // The model heard a codec reconstruction of the context. Blend that decoded
    // context back into the untouched waveform for 35 ms so the codec boundary
    // itself cannot become a new click.
    for (let i = 0; i < edge; i += 1) {
      const t = edge === 1 ? 1 : i / (edge - 1)
      const weight = 0.5 - Math.cos(t * Math.PI) * 0.5
      const tailIndex = bridgeOffset - edge + i
      const decodedTail = generatedChannel[clamp(generatedStart - edge + i, 0, generatedChannel.length - 1)]
      output[tailIndex] = output[tailIndex] * (1 - weight) + decodedTail * weight
      const decodedHead = generatedChannel[clamp(generatedStart + generatedLength + i, 0, generatedChannel.length - 1)]
      output[i] = decodedHead * (1 - weight) + output[i] * weight
    }
    channels.push(output)
  }
  return { channels, sampleRate: rate, duration: outputLength / rate }
}

/** Lower is better. Scores both joins introduced by the generated bridge. */
export function circularInpaintCost(loop: RenderedLoop, bridgeSeconds: number): number {
  const bridge = clamp(Math.round(bridgeSeconds * loop.sampleRate), 1, loop.channels[0].length - 1)
  const transition = loop.channels[0].length - bridge
  const window = Math.max(16, Math.min(Math.round(loop.sampleRate * 0.08), bridge, transition))
  return loop.channels.reduce((sum, channel) =>
    sum + seamCost(channel, 0, channel.length, window) + seamCost(channel, transition, transition, window), 0) / loop.channels.length
}

export function encodeWav(loop: RenderedLoop): Uint8Array<ArrayBuffer> {
  const channelCount = loop.channels.length
  const sampleCount = loop.channels[0].length
  const bytesPerSample = 2
  const dataSize = sampleCount * channelCount * bytesPerSample
  const output = new ArrayBuffer(44 + dataSize)
  const view = new DataView(output)
  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i))
  }

  writeText(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeText(8, 'WAVE')
  writeText(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channelCount, true)
  view.setUint32(24, loop.sampleRate, true)
  view.setUint32(28, loop.sampleRate * channelCount * bytesPerSample, true)
  view.setUint16(32, channelCount * bytesPerSample, true)
  view.setUint16(34, 16, true)
  writeText(36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < sampleCount; i += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = clamp(loop.channels[channel][i], -1, 1)
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      offset += 2
    }
  }
  return new Uint8Array(output)
}
