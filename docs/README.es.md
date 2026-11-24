<div align="center">

<img src="app-icon.svg" alt="SeamForge" width="104" height="104" />

# SeamForge

**Estudio de escritorio de precisión para bucles musicales sin cortes** · *por **Aviello Studio***

[![CI](https://github.com/NIGATAulxgenii/seamforge/actions/workflows/ci.yml/badge.svg)](https://github.com/NIGATAulxgenii/seamforge/actions/workflows/ci.yml)
[![Release](https://img.shields.io/badge/Release-v2.0.0-e59a3c.svg)](https://github.com/NIGATAulxgenii/seamforge/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-5da3e0.svg)](../LICENSE)
![Platform: Windows 10/11](https://img.shields.io/badge/Platform-Windows%2010%2F11-272b33.svg)
![Stack: Tauri v2 + Rust](https://img.shields.io/badge/Stack-Tauri%20v2%20%2B%20Rust-191c21.svg)
![Languages: 6](https://img.shields.io/badge/Languages-6-4ecb8d.svg)

[English](../README.md) · [Русский](README.ru.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · **Español** · [Deutsch](README.de.md)

DSP multihilo en Rust sin conexión · Extracción directa de audio desde vídeo sin FFmpeg · EXE portátil autónomo de 6.92 MB

<br/>

![Interfaz de SeamForge Studio](preview-studio.png)

</div>

---

## Descripción general

**SeamForge v2** localiza automáticamente puntos de bucle musicalmente coherentes en archivos de audio y vídeo, alinea la fase estéreo en el empalme, muestra el cruce en un osciloscopio en tiempo real y exporta archivos WAV limpios a la frecuencia de muestreo original — 100 % sin conexión, sin DLL externas, sin descargar FFmpeg y con 6 idiomas integrados.

Reescrito de Electron a **Tauri v2 + Rust**, la versión v2 reduce la huella portátil en Windows de **~350 MB a 6.92 MB** (**~50× más ligero**, `2.92 MB` en ZIP) mientras cuadruplica la resolución temporal del análisis STFT de **46.4 ms a 11.6 ms** (**4× más preciso**).

<div align="center">

![Comparativa de arquitectura y tamaño de SeamForge v2](comparison-chart.svg)

</div>

---

## Comparativa

| Característica | **SeamForge v2** | SeamForge v1 (anterior) | PyMusicLooper | Audacity |
| :--- | :--- | :--- | :--- | :--- |
| **Stack y tamaño** | Tauri v2 + Rust (`6.92 MB` EXE único, `2.92 MB` ZIP) | Electron + JS (`~350 MB` portátil + caché IA opcional de `5.7 GB`) | CLI en Python / TUI opcional (requiere Python + NumPy/SciPy/librosa) | C++ / wxWidgets (instalación de `~120+ MB`) |
| **Motor DSP** | Rust multihilo (`rustfft` + `rayon`), paso de `11.6 ms` (`hop=512`), seguimiento de pulso Ellis DP | JS monohilo (`Meyda`), paso de `46.4 ms` (`hop=2048`) | Análisis musical de bucles y ataques en Python (`librosa` / SciPy) | Editor de audio general (búsqueda manual de bucles) |
| **Búsqueda automática de bucles** | Hasta 8 candidatos clasificados (armonía, frase, ritmo y fase) | Búsqueda básica de bucles | Sólida detección automática de bucles musicales | Selección manual (sin ranking por matriz de recurrencia) |
| **Osciloscopio de empalme** | Superposición en vivo de fin, inicio y mezcla + ajuste ±1/±10 ms | Ninguno | Flujo en terminal / CLI (sin editor visual de osciloscopio) | Línea de tiempo de onda (sin superposición de fase en vivo) |
| **Extracción directa de vídeo** | Nativa con `symphonia` + Windows Media Foundation (10 contenedores, sin FFmpeg) | No (solo archivos de audio) | CLI orientado a audio (depende de decodificadores externos) | Requiere biblioteca FFmpeg opcional para la mayoría de vídeos |
| **Reproducción y exportación** | WASAPI sin pausas (`cpal`), WAV `16-bit` (TPDF), `24-bit`, `32-bit float` a frecuencia original | Solo WAV `16-bit` remuestreado por Web Audio | Previsualización y exportación vía bibliotecas Python | Edición multipista y exportación completa |
| **Idiomas de interfaz** | 6 integrados (`EN`, `RU`, `ZH`, `JA`, `ES`, `DE`) | Solo ruso | CLI en inglés | Interfaz de escritorio multilingüe |

---

## Flujo de análisis DSP

```mermaid
flowchart LR
  A["Archivo Audio / Vídeo"] --> B["Decodificación Symphonia + WMF"]
  B --> C["STFT (hop 512, 11.6 ms)"]
  C --> D["Chroma 12 bandas + Flujo"]
  D --> E["BPM fraccional + Ellis DP"]
  E --> F["Matriz de recurrencia"]
  F --> G["Alineación fase estéreo (±25 ms)"]
  G --> H["Top 8 candidatos + Inspector"]
  H --> I["Exportación WAV 16/24/32-bit"]
```

---

## Características principales

- **Decodificación nativa sin remuestreo (`symphonia` + Windows Media Foundation)**
  - Decodifica audio y extrae pistas de audio directamente desde contenedores de vídeo a su frecuencia de muestreo original — sin binarios de FFmpeg.
- **DSP musical multihilo en Rust (`rustfft` + `rayon`)**
  - STFT de alta resolución (`hop = 512`, `11.6 ms` a 44.1 kHz) con protección frente a silencios y `NaN`.
  - Chroma logarítmico de 12 bandas, flujo espectral, centroide, energía RMS y balance tímbrico.
  - Estimación fraccional de BPM + seguimiento de pulsos por programación dinámica Ellis (2007) sin deriva en pistas largas.
  - Detección de compás (`3/4`, `4/4`) y matriz de recurrencia con refuerzo diagonal de frases repetidas.
  - Ajuste conjunto de límites (`±25 ms`) con alineación de fase estéreo que preserva la duración exacta de la frase musical.
  - Hasta 8 candidatos ordenados con desglose de Armonía, Frase, Ritmo y Fase.
- **Editor de onda interactivo e Inspector de empalme**
  - Forma de onda Canvas High-DPI con zoom por rueda, desplazamiento horizontal, regla de tiempo y cuadrícula de pulsos.
  - Osciloscopio en tiempo real que superpone el final del bucle, el inicio y el empalme resultante.
  - Ajuste fino de límites (`±1 ms`, `±10 ms`), acoplamiento a cruce por cero, curva de crossfade seleccionable (**Constant-Gain** o **Equal-Power**) y recorte previo al análisis.
- **Reproductor nativo WASAPI sin cortes (`cpal`)**
  - Hilo de audio dedicado en tiempo real con bucle continuo y suavizado anticlic de 4 ms.
  - Escucha rápida del empalme (`S` salta 2.5 s antes del final del bucle), volumen de monitoreo suave y Silencio (`M`).
- **Exportación WAV de estudio (`hound`)**
  - **16-bit PCM** (con tramado TPDF determinista), **24-bit PCM** y **32-bit IEEE float** a la frecuencia de muestreo original exacta.
- **6 idiomas integrados**
  - Cambio instantáneo entre English, Русский, 简体中文, 日本語, Español y Deutsch.

---

## Formatos compatibles

| Categoría | Formatos | Notas |
| :--- | :--- | :--- |
| **Entrada de audio** | `WAV`, `FLAC`, `MP3`, `OGG`, `M4A`, `AAC`, `AIFF` (`AIF`), `Opus`, `WMA` | Decodificación nativa a frecuencia original con `symphonia` + WMF |
| **Entrada de vídeo** | `MP4`, `MOV`, `MKV`, `WebM`, `AVI`, `WMV`, `M4V`, `3GP`, `MPEG` (`MPG`) | Extracción directa de la pista de audio — sin FFmpeg |
| **Exportación WAV** | `16-bit PCM` (dither TPDF), `24-bit PCM`, `32-bit IEEE float` | Frecuencia de muestreo original exacta mediante `hound` |

---

## Descarga (Portátil)

Compilación portátil lista para Windows 10/11 (x64) — sin instalador, sin DLL adicionales y sin entornos externos:

1. Abre **[GitHub Releases](https://github.com/NIGATAulxgenii/seamforge/releases)**.
2. Descarga `SeamForge-portable.zip` (`2.92 MB`) y extráelo en cualquier carpeta.
3. Ejecuta `SeamForge.exe` (ejecutable autónomo de `6.92 MB`).

---

## Atajos de teclado

| Atajo | Acción |
| :--- | :--- |
| `Space` | Reproducir / Pausar |
| `S` | Audicionar empalme (salta 2.5 s antes del final del bucle) |
| `M` | Silenciar / Activar audio de monitoreo |
| `1–8` | Cambiar entre los candidatos de bucle encontrados |
| `Ctrl+O` | Abrir archivo de audio o vídeo |
| `Ctrl+S` | Exportar WAV sin cortes |
| `Rueda del ratón` | Acercar / alejar la forma de onda |
| `Shift + rueda` | Desplazamiento horizontal con zoom |

---

## Estructura del proyecto

```text
src-tauri/src/
├── audio_io.rs   # Decodificación Symphonia + Windows Media Foundation, recorte, picos y exportación WAV
├── dsp.rs        # STFT, chroma, Ellis DP beat tracking, matriz de recurrencia, fase y crossfade
├── playback.rs   # Hilo WASAPI dedicado (cpal), bucle sin cortes, ganancia suave, anticlic
├── error.rs      # Errores tipados de la aplicación
├── lib.rs        # Comandos IPC de Tauri v2, cancelación de análisis y cierre seguro
└── main.rs       # Punto de entrada de escritorio en Windows

src/
├── api/          # Puente IPC tipado con Tauri y diálogos nativos del sistema
├── components/   # WaveformCanvas, SeamInspector, CandidateSidebar, TransportBar, TrimModal, TitleBar
└── lib/          # i18n en 6 idiomas, utilidades de formato y pruebas unitarias
```

---

## Compilar desde el código fuente

Requisitos: **Windows 10/11**, **Node.js 20+**, **Rust 1.90+ (MSVC)** y **WebView2** (incluido en Windows 10/11).

```powershell
# Instalar dependencias del frontend
npm install

# Ejecutar en modo desarrollo
npm run tauri:dev

# Verificación completa: TypeScript, Vitest, pruebas de Cargo y build del frontend
npm run check

# Compilar EXE portátil autónomo y archivo ZIP (release/SeamForge-portable.zip)
npm run dist:portable
```

---

## Licencia

Creado por **Aviello Studio**. Distribuido bajo la **[Licencia MIT](../LICENSE)**.  
Las licencias y atribuciones de bibliotecas de código abierto de terceros (incluido el aviso MPL-2.0 de `symphonia`) se encuentran en [THIRD_PARTY_LICENSES.md](../THIRD_PARTY_LICENSES.md).
