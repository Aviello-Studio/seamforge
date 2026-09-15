import { spawn } from 'node:child_process'
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { ProcessingDevice } from './settings.js'

const PACKAGES = ['audio-separator[cpu]==0.47.0', 'audioread>=3.0']
const MODEL = 'model_bs_roformer_ep_317_sdr_12.9755.ckpt'
const UV_URL = 'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip'
const FFMPEG_URL = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl.zip'
const TORCH_CUDA_INDEX = 'https://download.pytorch.org/whl/cu130'

export type AiRuntimeState = {
  ready: boolean
  label: string
}

type Progress = (message: string) => void

const exists = async (path: string) => access(path).then(() => true, () => false)

function run(command: string, args: string[], onOutput?: Progress, env?: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, shell: false, env })
    let tail = ''
    const capture = (chunk: Buffer) => {
      const text = chunk.toString().replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '').trim()
      if (!text) return
      tail = `${tail}\n${text}`.slice(-4000)
      onOutput?.(text.split(/\r?\n/).at(-1) ?? text)
    }
    child.stdout.on('data', capture)
    child.stderr.on('data', capture)
    child.on('error', reject)
    child.on('close', (code) => code === 0
      ? resolve()
      : reject(new Error(tail.trim() || `${basename(command)} завершился с кодом ${code}`)))
  })
}

export function aiPaths(userData: string) {
  const root = join(userData, 'ai-studio')
  return {
    root,
    uv: join(root, 'tools', 'uv.exe'),
    ffmpeg: join(root, 'tools', 'ffmpeg.exe'),
    python: join(root, 'runtime', 'Scripts', 'python.exe'),
    separator: join(root, 'runtime', 'Scripts', 'audio-separator.exe'),
    readyMarker: join(root, 'runtime', '.seamforge-ready'),
    deviceMarker: join(root, 'runtime', '.seamforge-device'),
    models: join(root, 'models'),
  }
}

export async function getAiRuntimeState(userData: string, device: ProcessingDevice): Promise<AiRuntimeState> {
  const paths = aiPaths(userData)
  const ready = await exists(paths.separator) && await exists(paths.readyMarker) && await exists(paths.ffmpeg)
  const configuredDevice = await readFile(paths.deviceMarker, 'utf8').then((value) => value.trim(), () => 'cpu')
  return {
    ready: ready && configuredDevice === device,
    label: !ready
      ? 'Установится при первом анализе'
      : configuredDevice === device
        ? `ИИ‑движок готов · ${device === 'cuda' ? 'GPU' : 'CPU'}`
        : `${device === 'cuda' ? 'GPU' : 'CPU'} настроится при анализе`,
  }
}

export async function detectNvidiaGpu(): Promise<{ available: boolean; name: string | null }> {
  return new Promise((resolve) => {
    const child = spawn('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], { windowsHide: true, shell: false })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.on('error', () => resolve({ available: false, name: null }))
    child.on('close', (code) => {
      const name = output.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null
      resolve({ available: code === 0 && Boolean(name), name })
    })
  })
}

async function ensureUv(root: string, uv: string, onProgress: Progress) {
  if (await exists(uv)) return
  onProgress('ИИ: загружаю менеджер локального Python…')
  const tools = join(root, 'tools')
  const archive = join(root, 'uv.zip')
  await mkdir(tools, { recursive: true })
  const response = await fetch(UV_URL)
  if (!response.ok) throw new Error(`Не удалось загрузить Python-менеджер: HTTP ${response.status}`)
  await writeFile(archive, Buffer.from(await response.arrayBuffer()))
  try {
    await run('tar', ['-xf', archive, '-C', tools])
  } finally {
    await rm(archive, { force: true })
  }
  if (!(await exists(uv))) throw new Error('Архив Python-менеджера повреждён')
}

async function ensureFfmpeg(root: string, ffmpeg: string, onProgress: Progress) {
  if (await exists(ffmpeg)) return
  onProgress('ИИ: загружаю локальный FFmpeg…')
  const tools = join(root, 'tools')
  const archive = join(root, 'ffmpeg.zip')
  const unpacked = join(root, 'ffmpeg-unpacked')
  const response = await fetch(FFMPEG_URL)
  if (!response.ok) throw new Error(`Не удалось загрузить FFmpeg: HTTP ${response.status}`)
  await writeFile(archive, Buffer.from(await response.arrayBuffer()))
  try {
    await mkdir(unpacked, { recursive: true })
    await run('tar', ['-xf', archive, '-C', unpacked])
    const files = await readdir(unpacked, { recursive: true })
    const executable = files.find((file) => /(^|[\\/])ffmpeg\.exe$/i.test(file))
    if (!executable) throw new Error('В архиве не найден ffmpeg.exe')
    await copyFile(join(unpacked, executable), ffmpeg)
  } finally {
    await rm(archive, { force: true })
    await rm(unpacked, { recursive: true, force: true })
  }
}

async function configureDevice(paths: ReturnType<typeof aiPaths>, device: ProcessingDevice, onProgress: Progress) {
  const current = await readFile(paths.deviceMarker, 'utf8').then((value) => value.trim(), () => 'cpu')
  if (current === device) return
  if (device === 'cuda') {
    const gpu = await detectNvidiaGpu()
    if (!gpu.available) throw new Error('NVIDIA GPU не обнаружен. Выберите CPU в настройках.')
    onProgress(`ИИ: настраиваю CUDA для ${gpu.name}…`)
    await run(paths.uv, [
      'pip', 'install', '--python', paths.python,
      '--reinstall-package', 'torch',
      'torch==2.14.0', '--index', TORCH_CUDA_INDEX,
    ], (line) => {
      if (/download|installed/i.test(line)) onProgress(`ИИ GPU: ${line}`)
    })
    await run(paths.python, ['-c', "import torch; assert torch.cuda.is_available(); print(torch.cuda.get_device_name(0))"])
  } else {
    onProgress('ИИ: переключаю движок на CPU…')
    await run(paths.uv, [
      'pip', 'install', '--python', paths.python,
      '--reinstall-package', 'torch',
      'torch==2.14.0',
    ], (line) => {
      if (/download|installed/i.test(line)) onProgress(`ИИ CPU: ${line}`)
    })
  }
  await writeFile(paths.deviceMarker, `${device}\n`)
}

export async function ensureAiRuntime(userData: string, onProgress: Progress, device: ProcessingDevice = 'cpu') {
  const paths = aiPaths(userData)
  const configuredDevice = await readFile(paths.deviceMarker, 'utf8').then((value) => value.trim(), () => 'cpu')
  if (
    await exists(paths.separator) &&
    await exists(paths.readyMarker) &&
    await exists(paths.ffmpeg) &&
    configuredDevice === device
  ) return paths
  await mkdir(paths.root, { recursive: true })
  await ensureUv(paths.root, paths.uv, onProgress)
  if (!(await exists(paths.separator)) || !(await exists(paths.readyMarker))) {
    onProgress('ИИ: создаю изолированный Python 3.12…')
    await run(paths.uv, ['venv', '--python', '3.12', '--clear', join(paths.root, 'runtime')], (line) => {
      if (/download|python|installed/i.test(line)) onProgress(`ИИ: ${line}`)
    })
    onProgress('ИИ: устанавливаю движок разделения стемов (один раз)…')
    await run(paths.uv, ['pip', 'install', '--python', paths.python, ...PACKAGES], (line) => {
      if (/Downloading|Installing|Successfully installed/i.test(line)) onProgress(`ИИ: ${line}`)
    })
    if (!(await exists(paths.separator))) throw new Error('ИИ‑движок установился не полностью')
    await run(paths.python, ['-c', 'import audio_separator, audioread'])
    await writeFile(paths.readyMarker, 'audio-separator=0.47.0\npython=3.12\n')
    await writeFile(paths.deviceMarker, 'cpu\n')
  }
  await ensureFfmpeg(paths.root, paths.ffmpeg, onProgress)
  await configureDevice(paths, device, onProgress)
  return paths
}

export async function separateVocals(
  userData: string,
  wavBytes: Uint8Array,
  onProgress: Progress,
  device: ProcessingDevice = 'cpu',
): Promise<Uint8Array> {
  const paths = await ensureAiRuntime(userData, onProgress, device)
  await mkdir(paths.models, { recursive: true })
  const work = await mkdtemp(join(tmpdir(), 'seamforge-ai-'))
  const input = join(work, 'source.wav')
  const output = join(work, 'stems')
  await mkdir(output)
  await writeFile(input, Buffer.from(wavBytes))
  try {
    onProgress('ИИ: отделяю вокал — первый запуск скачает модель…')
    const separatorPath = `${join(paths.root, 'tools')};${process.env.PATH ?? ''}`
    await run(paths.separator, [
      input,
      '--model_filename', MODEL,
      '--model_file_dir', paths.models,
      '--output_dir', output,
      '--output_format', 'WAV',
      '--single_stem', 'Vocals',
      '--custom_output_names', '{"Vocals":"seamforge-vocals"}',
      '--use_soundfile',
    ], (line) => {
      const percent = line.match(/(\d{1,3})%/i)?.[1]
      if (percent) onProgress(`ИИ: отделяю вокал · ${percent}%`)
      else if (/download/i.test(line)) onProgress('ИИ: загружаю модель BS‑RoFormer…')
      else if (/loading model/i.test(line)) onProgress('ИИ: загружаю модель в память…')
      else if (/saving vocals/i.test(line)) onProgress('ИИ: сохраняю вокальную карту…')
    }, { ...process.env, PATH: separatorPath })
    const files = await readdir(output)
    const vocalFile = files.find((file) => /^seamforge-vocals\.wav$/i.test(file))
      ?? files.find((file) => /vocal.*\.wav$/i.test(file))
      ?? files.find((file) => /\.wav$/i.test(file))
    if (!vocalFile) throw new Error('Модель не вернула вокальную дорожку')
    return new Uint8Array(await readFile(join(output, vocalFile)))
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}
