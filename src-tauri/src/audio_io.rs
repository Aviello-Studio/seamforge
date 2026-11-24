use std::fs::File;
use std::path::Path;

use hound::{SampleFormat as HoundSampleFormat, WavSpec, WavWriter};
use serde::{Deserialize, Serialize};
use symphonia::core::codecs::{CodecParameters, audio::AudioDecoderOptions};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;

use crate::error::AppError;

pub const DEFAULT_WAVEFORM_BUCKETS: usize = 1800;

#[derive(Debug, Clone)]
pub struct AudioData {
    pub channels: Vec<Vec<f32>>,
    pub sample_rate: u32,
    pub duration: f64,
    pub file_name: String,
    pub file_path: String,
    pub bit_depth: Option<u32>,
    pub format_label: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSummary {
    pub file_name: String,
    pub file_path: String,
    pub sample_rate: u32,
    pub channels: usize,
    pub duration: f64,
    pub bit_depth: Option<u32>,
    pub format_label: String,
    pub peaks: Vec<[f32; 2]>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WavFormat {
    Pcm16,
    Pcm24,
    Float32,
}

impl AudioData {
    pub fn frame_count(&self) -> usize {
        self.channels.first().map_or(0, Vec::len)
    }

    pub fn summary(&self, max_buckets: usize) -> AudioSummary {
        AudioSummary {
            file_name: self.file_name.clone(),
            file_path: self.file_path.clone(),
            sample_rate: self.sample_rate,
            channels: self.channels.len(),
            duration: self.duration,
            bit_depth: self.bit_depth,
            format_label: self.format_label.clone(),
            peaks: compute_waveform_peaks(&self.channels, max_buckets),
        }
    }
}

pub fn decode_audio_file(path: &Path) -> Result<AudioData, AppError> {
    if !path.exists() {
        return Err(AppError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Файл не найден",
        )));
    }

    match decode_with_symphonia(path) {
        Ok(data) => Ok(data),
        Err(symphonia_err) => {
            #[cfg(windows)]
            {
                match decode_with_media_foundation(path) {
                    Ok(data) => return Ok(data),
                    Err(mf_err) => {
                        return Err(AppError::Decode(format!(
                            "Не удалось извлечь аудиодорожку ({symphonia_err}; Media Foundation: {mf_err})"
                        )));
                    }
                }
            }
            #[cfg(not(windows))]
            {
                Err(symphonia_err)
            }
        }
    }
}

fn decode_with_symphonia(path: &Path) -> Result<AudioData, AppError> {
    let file = File::open(path)?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase());
    if let Some(ref ext_str) = ext {
        hint.with_extension(ext_str);
    }

    let mut reader = symphonia::default::get_probe()
        .probe(
            &hint,
            mss,
            FormatOptions::default(),
            MetadataOptions::default(),
        )
        .map_err(|err| AppError::Decode(err.to_string()))?;

    let track = reader
        .default_track(TrackType::Audio)
        .ok_or_else(|| AppError::Decode("Аудиодорожка не найдена".to_string()))?;

    let track_id = track.id;
    let audio_params = match track.codec_params.as_ref() {
        Some(CodecParameters::Audio(params)) => params.clone(),
        _ => {
            return Err(AppError::Decode(
                "Отсутствуют параметры аудиокодека".to_string(),
            ));
        }
    };

    let mut sample_rate = audio_params.sample_rate.unwrap_or(0);
    let bit_depth = audio_params.bits_per_sample;
    let mut channel_count = audio_params
        .channels
        .as_ref()
        .map(|ch| ch.count())
        .unwrap_or(0);

    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(&audio_params, &AudioDecoderOptions::default())
        .map_err(|err| AppError::Decode(err.to_string()))?;

    let mut channels: Vec<Vec<f32>> = if channel_count > 0 {
        let cap = track.num_frames.unwrap_or(0).min(10_000_000) as usize;
        (0..channel_count)
            .map(|_| Vec::with_capacity(cap))
            .collect()
    } else {
        Vec::new()
    };

    let mut interleaved: Vec<f32> = Vec::new();

    loop {
        let packet = match reader.next_packet() {
            Ok(Some(packet)) => packet,
            Ok(None) => break,
            Err(SymphoniaError::IoError(err))
                if err.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(SymphoniaError::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Err(err) => return Err(AppError::Decode(err.to_string())),
        };

        if packet.track_id != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(SymphoniaError::IoError(err))
                if err.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(err) => return Err(AppError::Decode(err.to_string())),
        };

        let spec = decoded.spec();
        if sample_rate == 0 {
            sample_rate = spec.rate();
        }
        let decoded_channels = spec.channels().count();
        if decoded_channels == 0 {
            continue;
        }

        if channels.is_empty() {
            channel_count = decoded_channels;
            channels = (0..channel_count).map(|_| Vec::new()).collect();
        }

        let frames = decoded.frames();
        if frames == 0 {
            continue;
        }

        interleaved.clear();
        decoded.copy_to_vec_interleaved(&mut interleaved);

        let actual_ch = channels.len();
        if decoded_channels == actual_ch {
            for frame in interleaved.chunks_exact(actual_ch) {
                for (ch, &sample) in channels.iter_mut().zip(frame.iter()) {
                    ch.push(if sample.is_finite() { sample } else { 0.0 });
                }
            }
        } else {
            for frame in interleaved.chunks_exact(decoded_channels) {
                for (idx, ch) in channels.iter_mut().enumerate() {
                    let s = frame[idx % decoded_channels];
                    ch.push(if s.is_finite() { s } else { 0.0 });
                }
            }
        }
    }

    if sample_rate == 0 || channels.is_empty() || channels[0].is_empty() {
        return Err(AppError::Decode(
            "Аудиофайл пуст или не содержит декодируемых сэмплов".to_string(),
        ));
    }

    let duration = channels[0].len() as f64 / sample_rate as f64;
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("audio")
        .to_string();
    let file_path = path.to_string_lossy().to_string();
    let format_label = ext
        .as_deref()
        .map(str::to_ascii_uppercase)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "AUDIO".to_string());

    Ok(AudioData {
        channels,
        sample_rate,
        duration,
        file_name,
        file_path,
        bit_depth,
        format_label,
    })
}

#[cfg(windows)]
fn decode_with_media_foundation(path: &Path) -> Result<AudioData, AppError> {
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::Foundation::RPC_E_CHANGED_MODE;
    use windows::Win32::Media::MediaFoundation::{
        MF_MT_AUDIO_NUM_CHANNELS, MF_MT_AUDIO_SAMPLES_PER_SECOND, MF_MT_MAJOR_TYPE,
        MF_MT_SUBTYPE, MF_SOURCE_READER_ALL_STREAMS, MF_SOURCE_READER_FIRST_AUDIO_STREAM,
        MF_SOURCE_READERF_CURRENTMEDIATYPECHANGED, MF_SOURCE_READERF_ENDOFSTREAM, MF_VERSION,
        MFAudioFormat_Float, MFCreateMediaType, MFCreateSourceReaderFromURL, MFMediaType_Audio,
        MFSTARTUP_LITE, MFShutdown, MFStartup,
    };
    use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx, CoUninitialize};
    use windows::core::PCWSTR;

    struct MfGuard {
        com_initialized: bool,
        mf_started: bool,
    }

    impl Drop for MfGuard {
        fn drop(&mut self) {
            unsafe {
                if self.mf_started {
                    let _ = MFShutdown();
                }
                if self.com_initialized {
                    CoUninitialize();
                }
            }
        }
    }

    unsafe {
        let com_hr = CoInitializeEx(None, COINIT_MULTITHREADED);
        let com_initialized = if com_hr.is_ok() {
            true
        } else if com_hr == RPC_E_CHANGED_MODE {
            false
        } else {
            return Err(AppError::Decode(format!(
                "Ошибка инициализации COM: {com_hr:?}"
            )));
        };

        let mut guard = MfGuard {
            com_initialized,
            mf_started: false,
        };

        MFStartup(MF_VERSION, MFSTARTUP_LITE)
            .map_err(|err| AppError::Decode(format!("MFStartup: {err}")))?;
        guard.mf_started = true;

        let wide_path: Vec<u16> = path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        let reader = MFCreateSourceReaderFromURL(PCWSTR(wide_path.as_ptr()), None)
            .map_err(|err| AppError::Decode(format!("Контейнер не поддерживается: {err}")))?;

        let all_streams = MF_SOURCE_READER_ALL_STREAMS.0 as u32;
        let audio_stream = MF_SOURCE_READER_FIRST_AUDIO_STREAM.0 as u32;

        reader
            .SetStreamSelection(all_streams, false)
            .map_err(|err| AppError::Decode(format!("SetStreamSelection(all): {err}")))?;
        reader
            .SetStreamSelection(audio_stream, true)
            .map_err(|_| AppError::Decode("Аудиодорожка в файле не найдена".to_string()))?;

        let requested_type = MFCreateMediaType()
            .map_err(|err| AppError::Decode(format!("MFCreateMediaType: {err}")))?;
        requested_type
            .SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio)
            .map_err(|err| AppError::Decode(format!("SetGUID(major): {err}")))?;
        requested_type
            .SetGUID(&MF_MT_SUBTYPE, &MFAudioFormat_Float)
            .map_err(|err| AppError::Decode(format!("SetGUID(sub): {err}")))?;

        reader
            .SetCurrentMediaType(audio_stream, None, &requested_type)
            .map_err(|err| AppError::Decode(format!("Не удалось декодировать аудиокодек: {err}")))?;

        let mut actual_type = reader
            .GetCurrentMediaType(audio_stream)
            .map_err(|err| AppError::Decode(format!("GetCurrentMediaType: {err}")))?;
        let mut sample_rate = actual_type
            .GetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND)
            .map_err(|err| AppError::Decode(format!("sample_rate: {err}")))?;
        let mut num_channels = actual_type
            .GetUINT32(&MF_MT_AUDIO_NUM_CHANNELS)
            .map_err(|err| AppError::Decode(format!("num_channels: {err}")))?
            as usize;

        if sample_rate == 0 || num_channels == 0 {
            return Err(AppError::Decode(
                "Некорректные параметры аудиодорожки".to_string(),
            ));
        }

        let mut channels: Vec<Vec<f32>> = (0..num_channels).map(|_| Vec::new()).collect();

        loop {
            let mut flags = 0u32;
            let mut sample = None;
            reader
                .ReadSample(
                    audio_stream,
                    0,
                    None,
                    Some(&mut flags),
                    None,
                    Some(&mut sample),
                )
                .map_err(|err| AppError::Decode(format!("ReadSample: {err}")))?;

            if (flags & MF_SOURCE_READERF_CURRENTMEDIATYPECHANGED.0 as u32) != 0 {
                actual_type = reader
                    .GetCurrentMediaType(audio_stream)
                    .map_err(|err| AppError::Decode(format!("GetCurrentMediaType: {err}")))?;
                sample_rate = actual_type
                    .GetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND)
                    .unwrap_or(sample_rate);
                num_channels = actual_type
                    .GetUINT32(&MF_MT_AUDIO_NUM_CHANNELS)
                    .unwrap_or(num_channels as u32) as usize;
                if channels.is_empty() && num_channels > 0 {
                    channels = (0..num_channels).map(|_| Vec::new()).collect();
                }
            }

            if let Some(sample) = sample {
                let buffer = sample
                    .ConvertToContiguousBuffer()
                    .map_err(|err| AppError::Decode(format!("ConvertToContiguousBuffer: {err}")))?;
                let mut ptr = std::ptr::null_mut();
                let mut current_len = 0u32;
                buffer
                    .Lock(&mut ptr, None, Some(&mut current_len))
                    .map_err(|err| AppError::Decode(format!("Buffer::Lock: {err}")))?;

                if !ptr.is_null() && current_len >= 4 {
                    let bytes = std::slice::from_raw_parts(ptr, current_len as usize);
                    let decoded_ch = num_channels.max(1);
                    let actual_ch = channels.len();
                    let frame_bytes = decoded_ch * 4;
                    for frame in bytes.chunks_exact(frame_bytes) {
                        if decoded_ch == actual_ch {
                            for (ch_idx, ch) in channels.iter_mut().enumerate() {
                                let start = ch_idx * 4;
                                let val = f32::from_le_bytes([
                                    frame[start],
                                    frame[start + 1],
                                    frame[start + 2],
                                    frame[start + 3],
                                ]);
                                ch.push(if val.is_finite() { val } else { 0.0 });
                            }
                        } else {
                            for (ch_idx, ch) in channels.iter_mut().enumerate() {
                                let start = (ch_idx % decoded_ch) * 4;
                                let val = f32::from_le_bytes([
                                    frame[start],
                                    frame[start + 1],
                                    frame[start + 2],
                                    frame[start + 3],
                                ]);
                                ch.push(if val.is_finite() { val } else { 0.0 });
                            }
                        }
                    }
                }

                let _ = buffer.Unlock();
            }

            if (flags & MF_SOURCE_READERF_ENDOFSTREAM.0 as u32) != 0 {
                break;
            }
        }

        drop(reader);
        drop(guard);

        if channels.is_empty() || channels[0].is_empty() {
            return Err(AppError::Decode(
                "Аудиодорожка пуста или не содержит сэмплов".to_string(),
            ));
        }

        let duration = channels[0].len() as f64 / sample_rate as f64;
        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("media")
            .to_string();
        let file_path = path.to_string_lossy().to_string();
        let format_label = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|s| s.to_ascii_uppercase())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "MEDIA".to_string());

        Ok(AudioData {
            channels,
            sample_rate,
            duration,
            file_name,
            file_path,
            bit_depth: None,
            format_label,
        })
    }
}

pub fn trim_audio(data: &AudioData, start_sec: f64, end_sec: f64) -> Result<AudioData, AppError> {
    if !start_sec.is_finite() || !end_sec.is_finite() {
        return Err(AppError::InvalidRange(
            "Границы обрезки должны быть конечными числами".to_string(),
        ));
    }

    let total_frames = data.frame_count();
    if total_frames == 0 || data.sample_rate == 0 {
        return Err(AppError::NoAudioLoaded);
    }

    let sr = data.sample_rate as f64;
    let start_clamped = start_sec.clamp(0.0, data.duration);
    let end_clamped = end_sec.clamp(0.0, data.duration);

    let start_idx = ((start_clamped * sr).round() as usize).min(total_frames);
    let end_idx = ((end_clamped * sr).round() as usize).min(total_frames);

    if end_idx <= start_idx {
        return Err(AppError::InvalidRange(
            "Конец обрезки должен быть позже начала".to_string(),
        ));
    }

    let channels: Vec<Vec<f32>> = data
        .channels
        .iter()
        .map(|ch| ch[start_idx..end_idx].to_vec())
        .collect();
    let duration = (end_idx - start_idx) as f64 / sr;

    Ok(AudioData {
        channels,
        sample_rate: data.sample_rate,
        duration,
        file_name: data.file_name.clone(),
        file_path: data.file_path.clone(),
        bit_depth: data.bit_depth,
        format_label: data.format_label.clone(),
    })
}

pub fn compute_waveform_peaks(channels: &[Vec<f32>], max_buckets: usize) -> Vec<[f32; 2]> {
    if channels.is_empty() || max_buckets == 0 {
        return Vec::new();
    }
    let total_frames = channels[0].len();
    if total_frames == 0 {
        return Vec::new();
    }

    let buckets = max_buckets.min(total_frames);
    let mut peaks = Vec::with_capacity(buckets);

    for b in 0..buckets {
        let start = (b * total_frames) / buckets;
        let end = (((b + 1) * total_frames) / buckets)
            .max(start + 1)
            .min(total_frames);

        let mut min_v = f32::INFINITY;
        let mut max_v = f32::NEG_INFINITY;

        for ch in channels {
            for &s in &ch[start..end] {
                if s < min_v {
                    min_v = s;
                }
                if s > max_v {
                    max_v = s;
                }
            }
        }

        if !min_v.is_finite() || !max_v.is_finite() {
            peaks.push([0.0, 0.0]);
        } else {
            peaks.push([min_v.clamp(-1.0, 1.0), max_v.clamp(-1.0, 1.0)]);
        }
    }

    peaks
}

pub fn export_wav(
    path: &Path,
    channels: &[Vec<f32>],
    sample_rate: u32,
    format: WavFormat,
) -> Result<(), AppError> {
    if channels.is_empty() || channels[0].is_empty() || sample_rate == 0 {
        return Err(AppError::Encode(
            "Нет аудиоданных для экспорта".to_string(),
        ));
    }

    let num_channels = channels.len();
    let num_frames = channels[0].len();
    if channels.iter().any(|ch| ch.len() != num_frames) {
        return Err(AppError::Encode(
            "Длины каналов не совпадают".to_string(),
        ));
    }

    let (bits_per_sample, sample_format) = match format {
        WavFormat::Pcm16 => (16, HoundSampleFormat::Int),
        WavFormat::Pcm24 => (24, HoundSampleFormat::Int),
        WavFormat::Float32 => (32, HoundSampleFormat::Float),
    };

    let spec = WavSpec {
        channels: u16::try_from(num_channels)
            .map_err(|_| AppError::Encode("Слишком много аудиоканалов".to_string()))?,
        sample_rate,
        bits_per_sample,
        sample_format,
    };

    let mut writer =
        WavWriter::create(path, spec).map_err(|err| AppError::Encode(err.to_string()))?;

    match format {
        WavFormat::Pcm16 => {
            let mut rng: u64 = 0x9E37_79B9_7F4A_7C15;
            for frame_idx in 0..num_frames {
                for ch in channels {
                    let s = ch[frame_idx];
                    let clamped = if s.is_finite() {
                        s.clamp(-1.0, 1.0) as f64
                    } else {
                        0.0
                    };
                    let r1 = xorshift64_unit(&mut rng);
                    let r2 = xorshift64_unit(&mut rng);
                    let dither = (r1 - r2) / 32_768.0;
                    let quantized = ((clamped + dither) * 32_767.0)
                        .round()
                        .clamp(-32_768.0, 32_767.0) as i16;
                    writer
                        .write_sample(quantized)
                        .map_err(|err| AppError::Encode(err.to_string()))?;
                }
            }
        }
        WavFormat::Pcm24 => {
            for frame_idx in 0..num_frames {
                for ch in channels {
                    let s = ch[frame_idx];
                    let clamped = if s.is_finite() {
                        s.clamp(-1.0, 1.0) as f64
                    } else {
                        0.0
                    };
                    let quantized = (clamped * 8_388_607.0)
                        .round()
                        .clamp(-8_388_608.0, 8_388_607.0) as i32;
                    writer
                        .write_sample(quantized)
                        .map_err(|err| AppError::Encode(err.to_string()))?;
                }
            }
        }
        WavFormat::Float32 => {
            for frame_idx in 0..num_frames {
                for ch in channels {
                    let s = ch[frame_idx];
                    let val = if s.is_finite() { s } else { 0.0 };
                    writer
                        .write_sample(val)
                        .map_err(|err| AppError::Encode(err.to_string()))?;
                }
            }
        }
    }

    writer
        .finalize()
        .map_err(|err| AppError::Encode(err.to_string()))?;
    Ok(())
}

#[inline]
fn xorshift64_unit(state: &mut u64) -> f64 {
    let mut x = *state;
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    *state = x;
    ((x >> 11) as f64) * (1.0 / ((1u64 << 53) as f64))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::PI;

    fn temp_wav_path(tag: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "seamforge_test_{}_{}_{}.wav",
            tag,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |d| d.as_nanos())
        ))
    }

    #[test]
    fn trim_audio_preserves_exact_samples_and_sample_rate() {
        let sr = 48_000u32;
        let frames = sr as usize;
        let left: Vec<f32> = (0..frames)
            .map(|i| (2.0 * PI * 440.0 * i as f64 / sr as f64).sin() as f32 * 0.5)
            .collect();
        let right: Vec<f32> = (0..frames)
            .map(|i| (2.0 * PI * 660.0 * i as f64 / sr as f64).cos() as f32 * 0.4)
            .collect();

        let data = AudioData {
            channels: vec![left.clone(), right.clone()],
            sample_rate: sr,
            duration: 1.0,
            file_name: "test.wav".to_string(),
            file_path: "test.wav".to_string(),
            bit_depth: Some(24),
            format_label: "WAV".to_string(),
        };

        let trimmed = trim_audio(&data, 0.25, 0.75).expect("trim should succeed");
        assert_eq!(trimmed.sample_rate, sr);
        assert_eq!(trimmed.channels.len(), 2);
        assert_eq!(trimmed.frame_count(), 24_000);
        assert!((trimmed.duration - 0.5).abs() < 1e-6);
        assert_eq!(trimmed.channels[0], left[12_000..36_000]);
        assert_eq!(trimmed.channels[1], right[12_000..36_000]);

        assert!(trim_audio(&data, 0.6, 0.4).is_err());
    }

    #[test]
    fn compute_waveform_peaks_clamps_and_captures_extrema() {
        let mut ch0 = vec![0.0f32; 1000];
        let mut ch1 = vec![0.0f32; 1000];
        ch0[150] = 0.85;
        ch1[151] = -0.92;
        ch0[800] = 1.5;

        let peaks = compute_waveform_peaks(&[ch0, ch1], 100);
        assert_eq!(peaks.len(), 100);
        assert!((peaks[15][0] - (-0.92)).abs() < 1e-5);
        assert!((peaks[15][1] - 0.85).abs() < 1e-5);
        assert_eq!(peaks[80][1], 1.0);
    }

    #[test]
    fn export_wav_and_decode_roundtrip_all_formats() {
        let sr = 48_000u32;
        let frames = 4800usize;
        let left: Vec<f32> = (0..frames)
            .map(|i| (2.0 * PI * 330.0 * i as f64 / sr as f64).sin() as f32 * 0.7)
            .collect();
        let right: Vec<f32> = (0..frames)
            .map(|i| (2.0 * PI * 550.0 * i as f64 / sr as f64).cos() as f32 * 0.6)
            .collect();
        let channels = vec![left, right];

        for (format, tol, tag) in [
            (WavFormat::Pcm16, 2.0e-4f32, "pcm16"),
            (WavFormat::Pcm24, 5.0e-6f32, "pcm24"),
            (WavFormat::Float32, 1.0e-6f32, "f32"),
        ] {
            let path = temp_wav_path(tag);
            export_wav(&path, &channels, sr, format).expect("export should succeed");
            let decoded = decode_audio_file(&path).expect("decode should succeed");
            let _ = std::fs::remove_file(&path);

            assert_eq!(decoded.sample_rate, sr, "sample rate mismatch for {tag}");
            assert_eq!(decoded.channels.len(), 2, "channel count mismatch for {tag}");
            assert_eq!(decoded.frame_count(), frames, "frame count mismatch for {tag}");

            let mut max_err = 0.0f32;
            for c in 0..2 {
                for i in 0..frames {
                    let err = (decoded.channels[c][i] - channels[c][i]).abs();
                    if err > max_err {
                        max_err = err;
                    }
                }
            }
            assert!(
                max_err <= tol,
                "roundtrip error {max_err} exceeded tolerance {tol} for {tag}"
            );
        }

        // Verify deterministic TPDF dithering for Pcm16
        let p1 = temp_wav_path("pcm16_det_a");
        let p2 = temp_wav_path("pcm16_det_b");
        export_wav(&p1, &channels, sr, WavFormat::Pcm16).expect("export a");
        export_wav(&p2, &channels, sr, WavFormat::Pcm16).expect("export b");
        let bytes1 = std::fs::read(&p1).expect("read a");
        let bytes2 = std::fs::read(&p2).expect("read b");
        let _ = std::fs::remove_file(&p1);
        let _ = std::fs::remove_file(&p2);
        assert_eq!(bytes1, bytes2, "PCM16 TPDF dithering must be deterministic");
    }

    #[cfg(windows)]
    #[test]
    fn media_foundation_decodes_stereo_audio_accurately() {
        let sr = 48_000u32;
        let frames = 4800usize;
        let left: Vec<f32> = (0..frames)
            .map(|i| (2.0 * PI * 440.0 * i as f64 / sr as f64).sin() as f32 * 0.6)
            .collect();
        let right: Vec<f32> = (0..frames)
            .map(|i| (2.0 * PI * 660.0 * i as f64 / sr as f64).cos() as f32 * 0.5)
            .collect();
        let path = temp_wav_path("mf_test");
        export_wav(&path, &[left.clone(), right.clone()], sr, WavFormat::Float32)
            .expect("export should succeed");
        let decoded = decode_with_media_foundation(&path).expect("Media Foundation decode failed");
        let _ = std::fs::remove_file(&path);

        assert_eq!(decoded.sample_rate, sr);
        assert_eq!(decoded.channels.len(), 2);
        assert_eq!(decoded.frame_count(), frames);
        let max_err = decoded.channels[0]
            .iter()
            .zip(left.iter())
            .map(|(a, b)| (a - b).abs())
            .fold(0.0f32, f32::max);
        assert!(max_err < 1e-4, "unexpected MF error: {max_err}");
    }
}
