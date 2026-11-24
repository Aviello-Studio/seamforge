<div align="center">

<img src="app-icon.svg" alt="SeamForge" width="104" height="104" />

# SeamForge

**シームレスな音楽オーディオループを作るための高精度デスクトップスタジオ**

[![CI](https://github.com/NIGATAulxgenii/seamforge/actions/workflows/ci.yml/badge.svg)](https://github.com/NIGATAulxgenii/seamforge/actions/workflows/ci.yml)
[![Release](https://img.shields.io/badge/Release-v2.0.0-e59a3c.svg)](https://github.com/NIGATAulxgenii/seamforge/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-5da3e0.svg)](../LICENSE)
![Platform: Windows 10/11](https://img.shields.io/badge/Platform-Windows%2010%2F11-272b33.svg)
![Stack: Tauri v2 + Rust](https://img.shields.io/badge/Stack-Tauri%20v2%20%2B%20Rust-191c21.svg)
![Languages: 6](https://img.shields.io/badge/Languages-6-4ecb8d.svg)

[English](../README.md) · [Русский](README.ru.md) · [简体中文](README.zh-CN.md) · **日本語** · [Español](README.es.md) · [Deutsch](README.de.md)

オフライン・マルチスレッド Rust DSP · FFmpeg 不要で動画から直接音声抽出 · 7.01 MB 単体ポータブル EXE

<br/>

![SeamForge Studio インターフェース](preview-studio.png)

</div>

---

## 概要

**SeamForge v2** は、音声・動画ファイルから音楽的に自然なループ境界を自動検出し、つなぎ目のステレオ位相を精密に整合、リアルタイムのシーム・オシロスコープで視覚化しながら、元のサンプルレートのままクリーンな WAV を書き出せるデスクトップスタジオです。完全オフライン動作、追加 DLL 不要、FFmpeg 不要、6 言語 UI を標準搭載しています。

Electron から **Tauri v2 + Rust** へ全面刷新したことで、Windows ポータブル版の容量は **約 350 MB から 7.01 MB**（**約 50 分の 1**、ZIP 版は `3.01 MB`）へ大幅に軽量化され、STFT の時間分解能も **46.4 ms から 11.6 ms**（**4 倍の高精細化**）を実現しました。

<div align="center">

![SeamForge v2 アーキテクチャおよび容量比較](comparison-chart.svg)

</div>

---

## 機能比較

| 項目 | **SeamForge v2** | SeamForge v1（旧版） | PyMusicLooper | Audacity |
| :--- | :--- | :--- | :--- | :--- |
| **構成・サイズ** | Tauri v2 + Rust（`7.01 MB` 単体 EXE、`3.01 MB` ZIP） | Electron + JS（`約 350 MB` + 任意 `5.7 GB` AI キャッシュ） | Python CLI / 任意 TUI（Python + NumPy/SciPy/librosa が必要） | C++ / wxWidgets（`約 120 MB 以上` のインストール） |
| **DSP 解析エンジン** | マルチスレッド Rust（`rustfft` + `rayon`）、`11.6 ms` ステップ（`hop=512`）、Ellis DP ビート追従 | シングルスレッド JS（`Meyda`）、`46.4 ms` ステップ（`hop=2048`） | Python による音楽ループ・オンセット解析（`librosa` / SciPy） | 汎用オーディオ編集（ループ点は手動探索） |
| **音楽ループ自動検出** | 最大 8 件をランク付け（和声・フレーズ・リズム・位相スコア） | 基本的なループ検出 | 高精度な自動音楽ループ検出 | 手動選択（ビート／クロマ再帰行列のランキングなし） |
| **シーム・オシロスコープ** | ループ終端・始端・クロスフェード後の重ね合わせ表示 + ±1/±10 ms 微調整 | なし | ターミナル CLI 中心（オシロスコープ編集 UI なし） | 波形タイムライン（リアルタイム位相重ね合わせなし） |
| **動画からの直接音声抽出** | `symphonia` + Windows Media Foundation ネイティブ対応（10 コンテナ、FFmpeg 不要） | 非対応（音声ファイルのみ） | 音声中心の CLI（外部デコーダバックエンド依存） | 多くの動画形式には別途 FFmpeg ライブラリが必要 |
| **再生と書き出し** | ギャップレス WASAPI（`cpal`）、原サンプルレートで `16-bit`（TPDF）・`24-bit`・`32-bit float` WAV | Web Audio リサンプル後の `16-bit` WAV のみ | Python 音声ライブラリ経由で再生・書き出し | マルチトラック編集・各種書き出し |
| **UI 言語** | 6 言語内蔵（`EN`、`RU`、`ZH`、`JA`、`ES`、`DE`） | ロシア語のみ | 英語 CLI | 多言語デスクトップ UI |

---

## DSP パイプライン

```mermaid
flowchart LR
  A["音声 / 動画ファイル"] --> B["Symphonia + WMF デコード"]
  B --> C["STFT (hop 512, 11.6 ms)"]
  C --> D["12次元クロマ + オンセットフラックス"]
  D --> E["小数 BPM + Ellis DP ビート追従"]
  E --> F["再帰行列 + 対角フレーズ強調"]
  F --> G["ステレオ位相整合 (±25 ms)"]
  G --> H["上位 8 候補 + シーム・インスペクタ"]
  H --> I["16/24/32-bit WAV 書き出し"]
```

---

## 主な機能

- **リサンプリングなしのネイティブデコード（`symphonia` + Windows Media Foundation）**
  - 音声ファイルはもちろん、動画コンテナからも元のサンプルレートのまま音声トラックを直接抽出。FFmpeg バイナリは不要です。
- **マルチスレッド Rust 音楽 DSP（`rustfft` + `rayon`）**
  - 高解像度 STFT（`hop = 512`、44.1 kHz で `11.6 ms`）と無音・`NaN` 対策。
  - 12 次元対数クロマ、スペクトルフラックス、重心、RMS、音色バランスを抽出。
  - 小数 BPM 推定と Ellis（2007）動的計画法ビート追従により、長尺トラックでもビートグリッドがドリフトしません。
  - 拍子推定（`3/4`・`4/4`）と対角フレーズ強調を備えた再帰行列解析。
  - 音楽フレーズ長を保ちながら、両端を連動して `±25 ms` 範囲でステレオ位相整合。
  - 和声・フレーズ・リズム・位相の個別スコア付きで最大 8 候補を提案。
- **インタラクティブ波形エディタ & シーム・インスペクタ**
  - マウスホイール拡大縮小・水平パン・タイムルーラー・ビートグリッド対応の High-DPI Canvas 波形。
  - ループ終端・始端・合成波形をリアルタイムに重ね合わせるオシロスコープ。
  - `±1 ms` / `±10 ms` 境界微調整、ゼロクロス吸着、クロスフェード曲線切替（**Constant-Gain** / **Equal-Power**）、解析前トリミングに対応。
- **ネイティブ・ギャップレス WASAPI 再生（`cpal`）**
  - 専用リアルタイム音声スレッドによる完全ギャップレスループと 4 ms アンチクリック処理。
  - つなぎ目の即座試聴（`S` キーで終端 2.5 秒前へジャンプ）、滑らかなモニター音量調節、ミュート（`M`）。
- **スタジオ品質 WAV 書き出し（`hound`）**
  - **16-bit PCM**（決定論的 TPDF ディザリング付き）、**24-bit PCM**、**32-bit IEEE float** を元のサンプルレートのまま出力。
- **6 言語の UI を標準搭載**
  - English、Русский、简体中文、日本語、Español、Deutsch をアプリ内で即時切替可能。

---

## 対応フォーマット

| カテゴリ | 対応フォーマット | 備考 |
| :--- | :--- | :--- |
| **音声入力** | `WAV`, `FLAC`, `MP3`, `OGG`, `M4A`, `AAC`, `AIFF` (`AIF`), `Opus`, `WMA` | `symphonia` + WMF により原サンプルレートでネイティブデコード |
| **動画入力** | `MP4`, `MOV`, `MKV`, `WebM`, `AVI`, `WMV`, `M4V`, `3GP`, `MPEG` (`MPG`) | 音声トラックを自動抽出（FFmpeg 不要） |
| **WAV 書き出し** | `16-bit PCM`（TPDF ディザ）, `24-bit PCM`, `32-bit IEEE float` | `hound` により元のサンプルレートを維持して書き出し |

---

## ダウンロード（ポータブル版）

Windows 10/11（x64）向けのポータブル実行ファイル。インストーラー・追加 DLL・外部ランタイム不要です。

1. **[GitHub Releases](https://github.com/NIGATAulxgenii/seamforge/releases)** を開きます。
2. `SeamForge-portable.zip`（`3.01 MB`）をダウンロードして任意のフォルダに展開します。
3. `SeamForge.exe`（`7.01 MB` 単体実行ファイル）を起動します。

---

## キーボードショートカット

| キー | 動作 |
| :--- | :--- |
| `Space` | 再生 / 一時停止 |
| `S` | シーム試聴（ループ終端の 2.5 秒前へ移動） |
| `M` | モニター音声のミュート切替 |
| `1–8` | 検出されたループ候補を切り替え |
| `Ctrl+O` | 音声または動画ファイルを開く |
| `Ctrl+S` | シームレス WAV を書き出し |
| `マウスホイール` | 波形の拡大・縮小 |
| `Shift + ホイール` | 拡大時の水平スクロール |

---

## プロジェクト構成

```text
src-tauri/src/
├── audio_io.rs   # Symphonia + Windows Media Foundation デコード、トリム、ピーク生成、WAV 書き出し
├── dsp.rs        # STFT、クロマ、Ellis DP ビート追従、再帰行列、位相整合、クロスフェード
├── playback.rs   # 専用 WASAPI スレッド（cpal）、ギャップレス再生、滑らかな音量制御、アンチクリック
├── error.rs      # 型付きアプリケーションエラー
├── lib.rs        # Tauri v2 IPC コマンド、解析キャンセル、安全な終了処理
└── main.rs       # Windows デスクトップエントリポイント

src/
├── api/          # 型付き Tauri IPC ブリッジと OS ファイルダイアログ
├── components/   # WaveformCanvas, SeamInspector, CandidateSidebar, TransportBar, TrimModal, TitleBar
└── lib/          # 6言語 i18n、時間・サンプルレート・ファイル名整形ユーティリティとテスト
```

---

## ソースからのビルド

必要な環境：**Windows 10/11**、**Node.js 20+**、**Rust 1.90+（MSVC）**、**WebView2**（Windows 10/11 に標準搭載）。

```powershell
# フロントエンド依存関係のインストール
npm install

# 開発モードで起動
npm run tauri:dev

# 総合チェック（TypeScript、Vitest、Cargo テスト、フロントエンドビルド）
npm run check

# ポータブル単体 EXE と ZIP アーカイブをビルド（release/SeamForge-portable.zip）
npm run dist:portable
```

---

## ライセンス

**[MIT License](../LICENSE)** の下で配布されています。  
サードパーティ製オープンソースライブラリのライセンス情報（`symphonia` の MPL-2.0 通知を含む）は [THIRD_PARTY_LICENSES.md](../THIRD_PARTY_LICENSES.md) をご覧ください。
