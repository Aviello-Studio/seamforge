use std::f64::consts::{FRAC_PI_2, PI};
use std::sync::atomic::{AtomicBool, Ordering};

use rayon::prelude::*;
use rustfft::{FftPlanner, num_complex::Complex};
use serde::{Deserialize, Serialize};

use crate::audio_io::AudioData;
use crate::error::AppError;

const NUM_BANDS: usize = 24;
const SEAM_PREVIEW_POINTS: usize = 240;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CrossfadeCurve {
    ConstantGain,
    EqualPower,
}

#[derive(Debug, Clone)]
pub struct RenderedLoop {
    pub channels: Vec<Vec<f32>>,
    pub sample_rate: u32,
    pub duration: f64,
    pub source_start_sec: f64,
    pub source_end_sec: f64,
    pub fade_samples: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeamPreviewData {
    pub tail: Vec<f32>,
    pub head: Vec<f32>,
    pub blended: Vec<f32>,
    pub crossfade_start_ratio: f64,
    pub crossfade_end_ratio: f64,
    pub phase_correlation: f64,
    pub seam_continuity: f64,
    pub loop_duration: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateDiagnostics {
    pub harmony: f64,
    pub recurrence: f64,
    pub rhythm: f64,
    pub phase: f64,
    pub timbre: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoopCandidate {
    pub id: u32,
    pub start: f64,
    pub end: f64,
    pub loop_duration: f64,
    pub confidence: u8,
    pub crossfade_ms: f64,
    pub curve: CrossfadeCurve,
    pub bars: Option<u32>,
    pub diagnostics: CandidateDiagnostics,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisResult {
    pub bpm: f64,
    pub beats_per_bar: u32,
    pub beat_times: Vec<f64>,
    pub candidates: Vec<LoopCandidate>,
}

#[inline]
pub fn crossfade_weights(t: f64, curve: CrossfadeCurve) -> (f64, f64) {
    let t = t.clamp(0.0, 1.0);
    match curve {
        CrossfadeCurve::ConstantGain => {
            let fade_in = 0.5 - 0.5 * (t * PI).cos();
            let fade_out = 1.0 - fade_in;
            (fade_out, fade_in)
        }
        CrossfadeCurve::EqualPower => {
            let fade_in = (t * FRAC_PI_2).sin();
            let fade_out = (t * FRAC_PI_2).cos();
            (fade_out, fade_in)
        }
    }
}

fn resolve_loop_bounds(
    channels: &[Vec<f32>],
    sample_rate: u32,
    start_sec: f64,
    end_sec: f64,
    crossfade_ms: f64,
) -> Result<(usize, usize, usize), AppError> {
    if channels.is_empty() || channels[0].is_empty() || sample_rate == 0 {
        return Err(AppError::NoAudioLoaded);
    }
    if !start_sec.is_finite() || !end_sec.is_finite() || !crossfade_ms.is_finite() {
        return Err(AppError::InvalidRange(
            "Параметры петли должны быть конечными числами".to_string(),
        ));
    }

    let total_frames = channels[0].len();
    let sr = sample_rate as f64;
    let max_dur = total_frames as f64 / sr;

    let start_clamped = start_sec.clamp(0.0, max_dur);
    let end_clamped = end_sec.clamp(0.0, max_dur);
    let start_idx = ((start_clamped * sr).round() as usize).min(total_frames);
    let end_idx = ((end_clamped * sr).round() as usize).min(total_frames);

    if end_idx <= start_idx + 1 {
        return Err(AppError::InvalidRange(
            "Выбранный фрагмент слишком короткий для петли".to_string(),
        ));
    }

    let region_len = end_idx - start_idx;
    let requested_fade = ((crossfade_ms.max(0.0) / 1000.0) * sr).round() as usize;
    let max_fade = (region_len.saturating_sub(1)) / 2;
    let fade_samples = requested_fade.min(max_fade);

    Ok((start_idx, end_idx, fade_samples))
}

pub fn render_seamless_loop(
    channels: &[Vec<f32>],
    sample_rate: u32,
    start_sec: f64,
    end_sec: f64,
    crossfade_ms: f64,
    curve: CrossfadeCurve,
) -> Result<RenderedLoop, AppError> {
    let (start_idx, end_idx, fade_samples) =
        resolve_loop_bounds(channels, sample_rate, start_sec, end_sec, crossfade_ms)?;

    let sr = sample_rate as f64;
    let region_len = end_idx - start_idx;
    let out_len = region_len - fade_samples;
    let body_start = start_idx + fade_samples;
    let body_end = end_idx - fade_samples;

    let weights: Vec<(f32, f32)> = (0..fade_samples)
        .map(|i| {
            let t = (i as f64 + 0.5) / fade_samples as f64;
            let (fo, fi) = crossfade_weights(t, curve);
            (fo as f32, fi as f32)
        })
        .collect();

    let rendered_channels: Vec<Vec<f32>> = channels
        .iter()
        .map(|ch| {
            let mut out = Vec::with_capacity(out_len);
            if body_end > body_start {
                out.extend_from_slice(&ch[body_start..body_end]);
            }
            for (i, &(fo, fi)) in weights.iter().enumerate() {
                let tail_sample = ch[body_end + i];
                let head_sample = ch[start_idx + i];
                out.push(tail_sample * fo + head_sample * fi);
            }
            out
        })
        .collect();

    Ok(RenderedLoop {
        channels: rendered_channels,
        sample_rate,
        duration: out_len as f64 / sr,
        source_start_sec: start_idx as f64 / sr,
        source_end_sec: end_idx as f64 / sr,
        fade_samples,
    })
}

pub fn compute_seam_preview(
    channels: &[Vec<f32>],
    sample_rate: u32,
    start_sec: f64,
    end_sec: f64,
    crossfade_ms: f64,
    curve: CrossfadeCurve,
) -> Result<SeamPreviewData, AppError> {
    let (start_idx, end_idx, fade_samples) =
        resolve_loop_bounds(channels, sample_rate, start_sec, end_sec, crossfade_ms)?;

    let total_frames = channels[0].len();
    let sr = sample_rate as f64;
    let region_len = end_idx - start_idx;
    let loop_duration = (region_len - fade_samples) as f64 / sr;

    let max_margin = ((0.025 * sr).round() as usize).max(1);
    let min_margin = ((0.004 * sr).round() as usize).max(1);
    let margin = if fade_samples > 0 {
        (fade_samples / 2).clamp(min_margin, max_margin)
    } else {
        ((0.020 * sr).round() as usize)
            .min(region_len / 2)
            .max(1)
    };
    let win_len = (fade_samples + 2 * margin).max(2);

    let inv_ch = 1.0 / channels.len() as f32;
    let sample_mono = |idx: isize| -> f32 {
        if idx < 0 || (idx as usize) >= total_frames {
            return 0.0;
        }
        let i = idx as usize;
        let mut sum = 0.0f32;
        for ch in channels {
            sum += ch[i];
        }
        sum * inv_ch
    };

    let mut tail_raw = Vec::with_capacity(win_len);
    let mut head_raw = Vec::with_capacity(win_len);
    let mut blended_raw = Vec::with_capacity(win_len);

    let tail_origin = end_idx as isize - fade_samples as isize;
    let head_origin = start_idx as isize;

    for k in 0..win_len {
        let offset = k as isize - margin as isize;
        let t_s = sample_mono(tail_origin + offset);
        let h_s = sample_mono(head_origin + offset);
        tail_raw.push(t_s);
        head_raw.push(h_s);

        let b_s = if k < margin {
            t_s
        } else if k >= margin + fade_samples {
            h_s
        } else if fade_samples > 0 {
            let t = ((k - margin) as f64 + 0.5) / fade_samples as f64;
            let (fo, fi) = crossfade_weights(t, curve);
            (t_s as f64 * fo + h_s as f64 * fi) as f32
        } else {
            h_s
        };
        blended_raw.push(b_s);
    }

    let tail = downsample_waveform_curve(&tail_raw, SEAM_PREVIEW_POINTS);
    let head = downsample_waveform_curve(&head_raw, SEAM_PREVIEW_POINTS);
    let blended = downsample_waveform_curve(&blended_raw, SEAM_PREVIEW_POINTS);

    let crossfade_start_ratio = margin as f64 / win_len as f64;
    let crossfade_end_ratio = (margin + fade_samples) as f64 / win_len as f64;

    let corr_len = if fade_samples >= 8 {
        fade_samples
    } else {
        ((0.020 * sr).round() as usize)
            .min(region_len / 2)
            .max(1)
    };
    let tail_corr_start = end_idx.saturating_sub(corr_len);
    let head_corr_start = start_idx.min(total_frames.saturating_sub(corr_len));

    let (avg_corr, worst_corr, rms_match, edge_smoothness) = compute_seam_metrics(
        channels,
        tail_corr_start,
        head_corr_start,
        corr_len,
        end_idx.saturating_sub(fade_samples),
        start_idx + fade_samples,
    );

    let phase_correlation = avg_corr.clamp(-1.0, 1.0);
    let phase_norm = (0.5 * (0.6 * worst_corr + 0.4 * avg_corr) + 0.5).clamp(0.0, 1.0);
    let seam_continuity =
        (0.50 * phase_norm + 0.25 * rms_match + 0.25 * edge_smoothness).clamp(0.0, 1.0);

    Ok(SeamPreviewData {
        tail,
        head,
        blended,
        crossfade_start_ratio,
        crossfade_end_ratio,
        phase_correlation,
        seam_continuity,
        loop_duration,
    })
}

fn compute_seam_metrics(
    channels: &[Vec<f32>],
    tail_start: usize,
    head_start: usize,
    len: usize,
    body_end_idx: usize,
    body_start_idx: usize,
) -> (f64, f64, f64, f64) {
    if channels.is_empty() || len == 0 {
        return (1.0, 1.0, 1.0, 1.0);
    }
    let total_frames = channels[0].len();
    let usable_len = len
        .min(total_frames.saturating_sub(tail_start))
        .min(total_frames.saturating_sub(head_start));
    if usable_len == 0 {
        return (1.0, 1.0, 1.0, 1.0);
    }

    let mut sum_corr = 0.0f64;
    let mut min_corr = 1.0f64;
    let mut sum_rms_tail = 0.0f64;
    let mut sum_rms_head = 0.0f64;
    let mut edge_err_sum = 0.0f64;

    for ch in channels {
        let a = &ch[tail_start..tail_start + usable_len];
        let b = &ch[head_start..head_start + usable_len];
        let (corr, rms_a, rms_b) = pearson_and_rms(a, b);
        sum_corr += corr;
        if corr < min_corr {
            min_corr = corr;
        }
        sum_rms_tail += rms_a;
        sum_rms_head += rms_b;

        let local_scale = (rms_a + rms_b).max(1e-4);
        let jump_start = if body_end_idx > 0 && body_end_idx < total_frames && tail_start < total_frames {
            (ch[body_end_idx - 1] - ch[tail_start]).abs() as f64
        } else {
            0.0
        };
        let jump_end = if body_start_idx < total_frames && head_start + usable_len > 0 {
            let last_head = (head_start + usable_len - 1).min(total_frames - 1);
            (ch[body_start_idx] - ch[last_head]).abs() as f64
        } else {
            0.0
        };
        edge_err_sum += (jump_start + jump_end) / (2.0 * local_scale);
    }

    let n_ch = channels.len() as f64;
    let avg_corr = sum_corr / n_ch;
    let rms_tail = sum_rms_tail / n_ch;
    let rms_head = sum_rms_head / n_ch;
    let rms_match = if rms_tail < 1e-6 && rms_head < 1e-6 {
        1.0
    } else {
        (1.0 - (rms_tail - rms_head).abs() / (rms_tail + rms_head + 1e-9)).clamp(0.0, 1.0)
    };
    let edge_smoothness = (-(edge_err_sum / n_ch) * 0.6).exp().clamp(0.0, 1.0);

    (avg_corr, min_corr, rms_match, edge_smoothness)
}

fn pearson_and_rms(a: &[f32], b: &[f32]) -> (f64, f64, f64) {
    let n = a.len().min(b.len());
    if n == 0 {
        return (1.0, 0.0, 0.0);
    }
    let nf = n as f64;
    let mut sum_a = 0.0f64;
    let mut sum_b = 0.0f64;
    let mut sq_a = 0.0f64;
    let mut sq_b = 0.0f64;
    for i in 0..n {
        let va = a[i] as f64;
        let vb = b[i] as f64;
        sum_a += va;
        sum_b += vb;
        sq_a += va * va;
        sq_b += vb * vb;
    }
    let rms_a = (sq_a / nf).sqrt();
    let rms_b = (sq_b / nf).sqrt();

    if rms_a < 1e-6 && rms_b < 1e-6 {
        return (1.0, rms_a, rms_b);
    }
    if rms_a < 1e-6 || rms_b < 1e-6 {
        return (0.0, rms_a, rms_b);
    }

    let mean_a = sum_a / nf;
    let mean_b = sum_b / nf;
    let mut num = 0.0f64;
    let mut den_a = 0.0f64;
    let mut den_b = 0.0f64;
    for i in 0..n {
        let da = a[i] as f64 - mean_a;
        let db = b[i] as f64 - mean_b;
        num += da * db;
        den_a += da * da;
        den_b += db * db;
    }

    let denom = (den_a * den_b).sqrt();
    let corr = if denom > 1e-12 {
        (num / denom).clamp(-1.0, 1.0)
    } else {
        // Constant/DC segments with matching sign correlate positively.
        if (mean_a - mean_b).abs() < 1e-5 {
            1.0
        } else if mean_a * mean_b > 0.0 {
            0.8
        } else {
            -0.5
        }
    };
    (corr, rms_a, rms_b)
}

fn downsample_waveform_curve(samples: &[f32], target_points: usize) -> Vec<f32> {
    if samples.is_empty() || target_points == 0 {
        return Vec::new();
    }
    if samples.len() == 1 {
        return vec![samples[0]; target_points];
    }

    if samples.len() <= target_points {
        let mut out = Vec::with_capacity(target_points);
        let max_src = (samples.len() - 1) as f64;
        let denom = (target_points.saturating_sub(1)).max(1) as f64;
        for i in 0..target_points {
            let pos = (i as f64 / denom) * max_src;
            let lo = pos.floor() as usize;
            let hi = (lo + 1).min(samples.len() - 1);
            let frac = (pos - lo as f64) as f32;
            out.push(samples[lo] * (1.0 - frac) + samples[hi] * frac);
        }
        return out;
    }

    let mut out = Vec::with_capacity(target_points);
    for i in 0..target_points {
        let start = (i * samples.len()) / target_points;
        let end = (((i + 1) * samples.len()) / target_points)
            .max(start + 1)
            .min(samples.len());
        let mut best = samples[start];
        let mut best_abs = best.abs();
        for &v in &samples[start + 1..end] {
            let av = v.abs();
            if av > best_abs {
                best_abs = av;
                best = v;
            }
        }
        out.push(if best.is_finite() { best } else { 0.0 });
    }
    out
}

pub fn snap_to_zero_crossing(channels: &[Vec<f32>], sample_rate: u32, time_sec: f64) -> f64 {
    if channels.is_empty() || channels[0].is_empty() || sample_rate == 0 || !time_sec.is_finite() {
        return time_sec.max(0.0);
    }

    let total_frames = channels[0].len();
    let sr = sample_rate as f64;
    let center = ((time_sec * sr).round() as isize).clamp(0, total_frames.saturating_sub(1) as isize);
    let radius = ((0.015 * sr).round() as isize).max(1);
    let lo = (center - radius).max(1) as usize;
    let hi = (center + radius).min(total_frames.saturating_sub(1) as isize) as usize;

    if hi <= lo {
        return center as f64 / sr;
    }

    let inv_ch = 1.0 / channels.len() as f32;
    let mono_at = |idx: usize| -> f32 {
        let mut s = 0.0f32;
        for ch in channels {
            s += ch[idx];
        }
        s * inv_ch
    };

    let rms_win = ((0.001 * sr).round() as usize).max(2);
    let local_rms = |idx: usize| -> f64 {
        let a = idx.saturating_sub(rms_win);
        let b = (idx + rms_win).min(total_frames);
        let mut sq = 0.0f64;
        for i in a..b {
            let v = mono_at(i) as f64;
            sq += v * v;
        }
        (sq / (b - a).max(1) as f64).sqrt()
    };

    let mut best_rising: Option<(usize, f64)> = None;
    let mut best_quiet: (usize, f64) = (center as usize, f64::INFINITY);

    for idx in lo..=hi {
        let prev = mono_at(idx - 1);
        let curr = mono_at(idx);
        let dist_penalty = ((idx as isize - center).abs() as f64) / (radius as f64) * 0.015;

        let quiet_cost = (curr.abs() as f64) + dist_penalty;
        if quiet_cost < best_quiet.1 {
            best_quiet = (idx, quiet_cost);
        }

        if prev <= 0.0 && curr > 0.0 {
            let crossing_amp = (prev.abs() + curr.abs()) as f64 * 0.5;
            let cost = crossing_amp + local_rms(idx) * 0.35 + dist_penalty;
            if best_rising.is_none_or(|(_, best_cost)| cost < best_cost) {
                best_rising = Some((idx, cost));
            }
        }
    }

    let chosen = best_rising.map_or(best_quiet.0, |(idx, _)| idx);
    chosen as f64 / sr
}

#[derive(Debug, Clone)]
struct FrameFeatures {
    chroma: [f32; 12],
    log_bands: [f32; NUM_BANDS],
    rms_db: f32,
    centroid: f32,
    low_ratio: f32,
    flatness: f32,
}

#[derive(Debug, Clone)]
struct BeatFeature {
    chroma: [f32; 12],
    log_bands: [f32; NUM_BANDS],
    rms_db: f32,
    centroid: f32,
    low_ratio: f32,
    flatness: f32,
    onset: f32,
}

struct RawCandidate {
    start_beat: usize,
    end_beat: usize,
    musical_score: f64,
    harmony: f64,
    timbre: f64,
    recurrence: f64,
    rhythm: f64,
    duration_sec: f64,
}

struct EvaluatedCandidate {
    start: f64,
    end: f64,
    loop_duration: f64,
    confidence: u8,
    raw_score: f64,
    crossfade_ms: f64,
    curve: CrossfadeCurve,
    bars: Option<u32>,
    diagnostics: CandidateDiagnostics,
}

pub fn find_musical_loops(
    data: &AudioData,
    cancel: &AtomicBool,
    on_progress: &(dyn Fn(f32, &str) + Sync),
) -> Result<AnalysisResult, AppError> {
    if data.channels.is_empty() || data.channels[0].is_empty() || data.sample_rate == 0 {
        return Err(AppError::NoAudioLoaded);
    }

    check_cancelled(cancel)?;
    on_progress(0.03, "Подготовка аудиосигнала");

    let sr = data.sample_rate as f64;
    let total_frames = data.frame_count();
    let duration = total_frames as f64 / sr;

    let inv_ch = 1.0 / data.channels.len() as f32;
    let mut mono = vec![0.0f32; total_frames];
    for i in 0..total_frames {
        let mut s = 0.0f32;
        for ch in &data.channels {
            s += ch[i];
        }
        mono[i] = if s.is_finite() { s * inv_ch } else { 0.0 };
    }

    let frame_size: usize = if data.sample_rate >= 88_200 { 4096 } else { 2048 };
    let hop_size: usize = frame_size / 4;

    if total_frames < frame_size || duration < 0.6 {
        on_progress(1.0, "Анализ завершён");
        return Ok(build_fallback_result(duration, 120.0, 4, Vec::new()));
    }

    check_cancelled(cancel)?;
    on_progress(0.08, "Спектральный анализ (STFT)");

    let num_frames = (total_frames - frame_size) / hop_size + 1;
    let hann: Vec<f32> = (0..frame_size)
        .map(|i| 0.5 - 0.5 * (2.0 * PI * i as f64 / frame_size as f64).cos() as f32)
        .collect();

    let half_bins = frame_size / 2 + 1;
    let bin_freq: Vec<f32> = (0..half_bins)
        .map(|k| (k as f64 * sr / frame_size as f64) as f32)
        .collect();

    let bin_chroma: Vec<Option<usize>> = bin_freq
        .iter()
        .map(|&f| {
            if (55.0..=3520.0).contains(&f) {
                let midi = 69.0 + 12.0 * (f as f64 / 440.0).log2();
                Some((midi.round() as i32).rem_euclid(12) as usize)
            } else {
                None
            }
        })
        .collect();

    let band_edges = compute_log_band_edges(sr, frame_size);
    let bin_band: Vec<Option<usize>> = (0..half_bins)
        .map(|k| {
            let f = bin_freq[k] as f64;
            if f < band_edges[0] || f >= band_edges[NUM_BANDS] {
                None
            } else {
                let mut b = 0;
                while b + 1 < NUM_BANDS && f >= band_edges[b + 1] {
                    b += 1;
                }
                Some(b)
            }
        })
        .collect();

    let chunk_size = (num_frames / 32).max(64);
    let frame_indices: Vec<usize> = (0..num_frames).collect();

    let features_res: Result<Vec<FrameFeatures>, AppError> = frame_indices
        .par_chunks(chunk_size)
        .map_init(
            || {
                let mut planner = FftPlanner::<f32>::new();
                let fft = planner.plan_fft_forward(frame_size);
                let scratch = vec![Complex::new(0.0f32, 0.0f32); fft.get_inplace_scratch_len()];
                let buf = vec![Complex::new(0.0f32, 0.0f32); frame_size];
                (fft, scratch, buf)
            },
            |(fft, scratch, buf), chunk| {
                if cancel.load(Ordering::Relaxed) {
                    return Err(AppError::Cancelled);
                }
                let mut local = Vec::with_capacity(chunk.len());
                for &frame_idx in chunk {
                    let offset = frame_idx * hop_size;
                    let slice = &mono[offset..offset + frame_size];

                    let mut energy = 0.0f64;
                    for i in 0..frame_size {
                        let s = slice[i];
                        energy += (s as f64) * (s as f64);
                        buf[i] = Complex::new(s * hann[i], 0.0);
                    }
                    let rms = (energy / frame_size as f64).sqrt();
                    let rms_db = if rms > 1e-6 {
                        (20.0 * rms.log10()) as f32
                    } else {
                        -120.0
                    };

                    if rms <= 1e-7 {
                        local.push(FrameFeatures {
                            chroma: [0.0; 12],
                            log_bands: [0.0; NUM_BANDS],
                            rms_db: -120.0,
                            centroid: 0.0,
                            low_ratio: 0.0,
                            flatness: 0.0,
                        });
                        continue;
                    }

                    fft.process_with_scratch(buf, scratch);

                    let mut chroma = [0.0f64; 12];
                    let mut band_energy = [0.0f64; NUM_BANDS];
                    let mut mag_sum = 0.0f64;
                    let mut weighted_freq = 0.0f64;
                    let mut total_power = 0.0f64;
                    let mut low_power = 0.0f64;
                    let mut log_power_sum = 0.0f64;
                    let mut active_bins = 0usize;

                    for k in 1..half_bins {
                        let re = buf[k].re as f64;
                        let im = buf[k].im as f64;
                        let pwr = re * re + im * im;
                        let mag = pwr.sqrt();

                        mag_sum += mag;
                        weighted_freq += mag * bin_freq[k] as f64;
                        total_power += pwr;
                        if bin_freq[k] < 250.0 {
                            low_power += pwr;
                        }
                        log_power_sum += (pwr + 1e-12).ln();
                        active_bins += 1;

                        if let Some(pc) = bin_chroma[k] {
                            chroma[pc] += pwr;
                        }
                        if let Some(b) = bin_band[k] {
                            band_energy[b] += mag;
                        }
                    }

                    let centroid = if mag_sum > 1e-12 {
                        (weighted_freq / mag_sum) as f32
                    } else {
                        0.0
                    };
                    let low_ratio = if total_power > 1e-12 {
                        (low_power / total_power).clamp(0.0, 1.0) as f32
                    } else {
                        0.0
                    };
                    let flatness = if total_power > 1e-12 && active_bins > 0 {
                        let geo = (log_power_sum / active_bins as f64).exp();
                        let arith = total_power / active_bins as f64;
                        (geo / arith).clamp(0.0, 1.0) as f32
                    } else {
                        0.0
                    };

                    let chroma_norm: f64 = chroma.iter().map(|v| v * v).sum::<f64>().sqrt();
                    let mut chroma_f32 = [0.0f32; 12];
                    if chroma_norm > 1e-12 {
                        for c in 0..12 {
                            chroma_f32[c] = (chroma[c] / chroma_norm) as f32;
                        }
                    }

                    let mut log_bands = [0.0f32; NUM_BANDS];
                    for b in 0..NUM_BANDS {
                        log_bands[b] = (1.0 + band_energy[b]).ln() as f32;
                    }

                    local.push(FrameFeatures {
                        chroma: chroma_f32,
                        log_bands,
                        rms_db,
                        centroid,
                        low_ratio,
                        flatness,
                    });
                }
                Ok(local)
            },
        )
        .collect::<Result<Vec<_>, _>>()
        .map(|chunks| chunks.into_iter().flatten().collect());

    let frames = features_res?;
    check_cancelled(cancel)?;
    on_progress(0.30, "Определение темпа и ритмической сетки");

    let mut onset_flux = vec![0.0f64; num_frames];
    for i in 1..num_frames {
        let mut flux = 0.0f64;
        for b in 0..NUM_BANDS {
            let diff = (frames[i].log_bands[b] - frames[i - 1].log_bands[b]) as f64;
            if diff > 0.0 {
                let weight = if b < 6 { 1.35 } else { 1.0 };
                flux += diff * weight;
            }
        }
        onset_flux[i] = flux;
    }

    let max_flux = onset_flux.iter().copied().fold(0.0f64, f64::max);
    if max_flux > 1e-9 {
        for v in &mut onset_flux {
            *v /= max_flux;
        }
    }

    let frames_per_sec = sr / hop_size as f64;
    let (bpm, period_frames) = estimate_tempo(&onset_flux, frames_per_sec);

    let beat_frames = track_beats_dp(&onset_flux, period_frames);
    let beat_times: Vec<f64> = beat_frames
        .iter()
        .map(|&f| ((f * hop_size + frame_size / 2) as f64 / sr).clamp(0.0, duration))
        .collect();

    check_cancelled(cancel)?;
    on_progress(0.44, "Анализ гармонии и размера такта");

    if beat_frames.len() < 4 {
        on_progress(1.0, "Анализ завершён");
        return Ok(build_fallback_result(duration, bpm, 4, beat_times));
    }

    let beat_features = build_beat_features(&frames, &onset_flux, &beat_frames);
    let (beats_per_bar, downbeat_offset) = detect_meter_and_downbeat(&beat_features);

    check_cancelled(cancel)?;
    on_progress(0.56, "Построение матрицы музыкальной похожести");

    let recurrence = build_recurrence_matrix(&beat_features);

    check_cancelled(cancel)?;
    on_progress(0.68, "Поиск музыкальных петель");

    let track_peak_rms_db = beat_features
        .iter()
        .map(|b| b.rms_db)
        .fold(-120.0f32, f32::max);
    let track_is_silent = track_peak_rms_db < -65.0;

    let raw_pool = collect_candidate_pool(
        &beat_features,
        &beat_times,
        &recurrence,
        beats_per_bar,
        downbeat_offset,
        duration,
        track_peak_rms_db,
        track_is_silent,
    );

    if raw_pool.is_empty() {
        on_progress(1.0, "Анализ завершён");
        return Ok(build_fallback_result(duration, bpm, beats_per_bar, beat_times));
    }

    check_cancelled(cancel)?;
    on_progress(0.78, "Фазовая подгонка стереоканалов");

    let evaluated_res: Result<Vec<EvaluatedCandidate>, AppError> = raw_pool
        .par_iter()
        .map(|raw| {
            if cancel.load(Ordering::Relaxed) {
                return Err(AppError::Cancelled);
            }
            Ok(refine_and_score_candidate(
                data,
                raw,
                &beat_times,
                bpm,
                beats_per_bar,
            ))
        })
        .collect();

    let mut evaluated = evaluated_res?;
    check_cancelled(cancel)?;
    on_progress(0.95, "Отбор лучших петель");

    evaluated.sort_by(|a, b| {
        b.raw_score
            .total_cmp(&a.raw_score)
            .then_with(|| b.loop_duration.total_cmp(&a.loop_duration))
    });

    let mut final_candidates: Vec<LoopCandidate> = Vec::with_capacity(8);
    for cand in evaluated {
        let duplicate = final_candidates.iter().any(|kept| {
            (kept.start - cand.start).abs() < 0.35 && (kept.end - cand.end).abs() < 0.35
        });
        if duplicate {
            continue;
        }
        final_candidates.push(LoopCandidate {
            id: (final_candidates.len() + 1) as u32,
            start: cand.start,
            end: cand.end,
            loop_duration: cand.loop_duration,
            confidence: cand.confidence,
            crossfade_ms: cand.crossfade_ms,
            curve: cand.curve,
            bars: cand.bars,
            diagnostics: cand.diagnostics,
        });
        if final_candidates.len() >= 8 {
            break;
        }
    }

    if final_candidates.is_empty() {
        on_progress(1.0, "Анализ завершён");
        return Ok(build_fallback_result(duration, bpm, beats_per_bar, beat_times));
    }

    on_progress(1.0, "Анализ завершён");
    Ok(AnalysisResult {
        bpm: (bpm * 10.0).round() / 10.0,
        beats_per_bar,
        beat_times,
        candidates: final_candidates,
    })
}

fn check_cancelled(cancel: &AtomicBool) -> Result<(), AppError> {
    if cancel.load(Ordering::Relaxed) {
        Err(AppError::Cancelled)
    } else {
        Ok(())
    }
}

fn compute_log_band_edges(sr: f64, frame_size: usize) -> [f64; NUM_BANDS + 1] {
    let min_f = (sr / frame_size as f64).max(40.0);
    let max_f = (sr * 0.48).min(12_000.0).max(min_f * 2.0);
    let ratio = max_f / min_f;
    let mut edges = [0.0f64; NUM_BANDS + 1];
    for (i, edge) in edges.iter_mut().enumerate() {
        *edge = min_f * ratio.powf(i as f64 / NUM_BANDS as f64);
    }
    edges
}

fn estimate_tempo(onset_flux: &[f64], frames_per_sec: f64) -> (f64, f64) {
    let n = onset_flux.len();
    let default_bpm = 120.0;
    let default_period = 60.0 * frames_per_sec / default_bpm;

    if n < 16 {
        return (default_bpm, default_period);
    }

    let mean = onset_flux.iter().sum::<f64>() / n as f64;
    let centered: Vec<f64> = onset_flux.iter().map(|&v| v - mean).collect();
    let energy: f64 = centered.iter().map(|&v| v * v).sum();
    if energy <= 1e-9 {
        return (default_bpm, default_period);
    }

    let min_lag = (frames_per_sec * 60.0 / 195.0).floor().max(2.0) as usize;
    let max_lag = (frames_per_sec * 60.0 / 55.0)
        .ceil()
        .min((n / 2).max(min_lag + 1) as f64) as usize;
    if max_lag <= min_lag + 2 {
        return (default_bpm, default_period);
    }

    let max_acf_lag = (max_lag * 2 + 2).min(n - 1);
    let mut acf = vec![0.0f64; max_acf_lag + 1];
    for lag in 1..=max_acf_lag {
        let len = n - lag;
        let mut sum = 0.0f64;
        for i in 0..len {
            sum += centered[i] * centered[i + lag];
        }
        acf[lag] = sum / len as f64;
    }

    let mut best_lag = min_lag;
    let mut best_score = f64::NEG_INFINITY;

    for lag in min_lag..=max_lag {
        let bpm = 60.0 * frames_per_sec / lag as f64;
        let prior = (-0.5 * ((bpm / 118.0).ln() / 0.55).powi(2)).exp();
        let raw = acf[lag].max(0.0);
        let double_harm = if lag * 2 <= max_acf_lag {
            acf[lag * 2].max(0.0)
        } else {
            0.0
        };
        let half_harm = if lag / 2 >= 1 {
            acf[lag / 2].max(0.0)
        } else {
            0.0
        };
        let score = (raw + 0.28 * double_harm + 0.12 * half_harm) * prior;
        if score > best_score {
            best_score = score;
            best_lag = lag;
        }
    }

    if best_score <= 1e-9 {
        return (default_bpm, default_period);
    }

    let delta = if best_lag > 1 && best_lag + 1 <= max_acf_lag {
        let y_prev = acf[best_lag - 1];
        let y_curr = acf[best_lag];
        let y_next = acf[best_lag + 1];
        let denom = y_prev - 2.0 * y_curr + y_next;
        if denom.abs() > 1e-12 && denom < 0.0 {
            (0.5 * (y_prev - y_next) / denom).clamp(-0.5, 0.5)
        } else {
            0.0
        }
    } else {
        0.0
    };

    let period_frames = (best_lag as f64 + delta).max(2.0);
    let bpm = (60.0 * frames_per_sec / period_frames).clamp(55.0, 195.0);
    (bpm, period_frames)
}

fn track_beats_dp(onset_flux: &[f64], period_frames: f64) -> Vec<usize> {
    let n = onset_flux.len();
    if n < 4 || period_frames < 2.0 {
        return Vec::new();
    }

    let mut local_onset = vec![0.0f64; n];
    for i in 0..n {
        let prev = if i > 0 { onset_flux[i - 1] } else { onset_flux[i] };
        let next = if i + 1 < n {
            onset_flux[i + 1]
        } else {
            onset_flux[i]
        };
        local_onset[i] = 0.25 * prev + 0.5 * onset_flux[i] + 0.25 * next;
    }

    let flux_energy: f64 = local_onset.iter().sum();
    if flux_energy <= 1e-6 {
        let mut grid = Vec::new();
        let mut pos = 0.0f64;
        while (pos.round() as usize) < n {
            grid.push(pos.round() as usize);
            pos += period_frames;
        }
        return grid;
    }

    let min_step = (0.5 * period_frames).round().max(1.0) as usize;
    let max_step = (2.0 * period_frames)
        .round()
        .max(min_step as f64 + 1.0) as usize;
    let penalty_weight = 6.0;

    let mut dp = vec![0.0f64; n];
    let mut back = vec![usize::MAX; n];

    for t in 0..n {
        let mut best_val = local_onset[t];
        let mut best_prev = usize::MAX;

        if t >= min_step {
            let start_prev = t.saturating_sub(max_step);
            let end_prev = t - min_step;
            for prev in start_prev..=end_prev {
                let ratio = (t - prev) as f64 / period_frames;
                let penalty = penalty_weight * ratio.ln().powi(2);
                let candidate = dp[prev] - penalty + local_onset[t];
                if candidate > best_val {
                    best_val = candidate;
                    best_prev = prev;
                }
            }
        }
        dp[t] = best_val;
        back[t] = best_prev;
    }

    let tail_start = n.saturating_sub((1.5 * period_frames).round() as usize);
    let mut cur = tail_start;
    let mut best_end = dp[cur];
    for (t, &score) in dp.iter().enumerate().skip(tail_start) {
        if score > best_end {
            best_end = score;
            cur = t;
        }
    }

    let mut beats = Vec::new();
    while cur != usize::MAX {
        beats.push(cur);
        cur = back[cur];
    }
    beats.reverse();
    beats
}

fn build_beat_features(
    frames: &[FrameFeatures],
    onset_flux: &[f64],
    beat_frames: &[usize],
) -> Vec<BeatFeature> {
    let mut out = Vec::with_capacity(beat_frames.len());
    let total = frames.len();

    for i in 0..beat_frames.len() {
        let start = beat_frames[i].min(total.saturating_sub(1));
        let end = if i + 1 < beat_frames.len() {
            beat_frames[i + 1].min(total)
        } else {
            total
        }
        .max(start + 1)
        .min(total);

        let count = (end - start) as f64;
        let mut chroma = [0.0f64; 12];
        let mut log_bands = [0.0f64; NUM_BANDS];
        let mut rms_sum = 0.0f64;
        let mut centroid_sum = 0.0f64;
        let mut low_sum = 0.0f64;
        let mut flatness_sum = 0.0f64;

        for f in &frames[start..end] {
            for c in 0..12 {
                chroma[c] += f.chroma[c] as f64;
            }
            for b in 0..NUM_BANDS {
                log_bands[b] += f.log_bands[b] as f64;
            }
            rms_sum += f.rms_db as f64;
            centroid_sum += f.centroid as f64;
            low_sum += f.low_ratio as f64;
            flatness_sum += f.flatness as f64;
        }

        let norm: f64 = chroma.iter().map(|v| v * v).sum::<f64>().sqrt();
        let mut chroma_f32 = [0.0f32; 12];
        if norm > 1e-12 {
            for c in 0..12 {
                chroma_f32[c] = (chroma[c] / norm) as f32;
            }
        }

        let mut bands_f32 = [0.0f32; NUM_BANDS];
        for b in 0..NUM_BANDS {
            bands_f32[b] = (log_bands[b] / count) as f32;
        }

        let onset_lo = start.saturating_sub(1);
        let onset_hi = (start + 2).min(onset_flux.len());
        let onset = onset_flux[onset_lo..onset_hi]
            .iter()
            .copied()
            .fold(0.0f64, f64::max) as f32;

        out.push(BeatFeature {
            chroma: chroma_f32,
            log_bands: bands_f32,
            rms_db: (rms_sum / count) as f32,
            centroid: (centroid_sum / count) as f32,
            low_ratio: (low_sum / count) as f32,
            flatness: (flatness_sum / count) as f32,
            onset,
        });
    }

    out
}

fn detect_meter_and_downbeat(beats: &[BeatFeature]) -> (u32, usize) {
    let n = beats.len();
    if n < 6 {
        return (4, 0);
    }

    let mut accent = vec![0.0f64; n];
    for i in 0..n {
        let harmonic_change = if i > 0 {
            1.0 - chroma_cosine(&beats[i - 1].chroma, &beats[i].chroma)
        } else {
            0.5
        };
        accent[i] = 0.50 * beats[i].onset as f64
            + 0.30 * beats[i].low_ratio as f64
            + 0.20 * harmonic_change;
    }

    let mut best_meter = 4u32;
    let mut best_offset = 0usize;
    let mut best_score = f64::NEG_INFINITY;

    for &meter in &[4usize, 3usize] {
        let mut bar_sim_sum = 0.0f64;
        let mut bar_sim_count = 0usize;
        for i in 0..n.saturating_sub(meter) {
            bar_sim_sum += chroma_cosine(&beats[i].chroma, &beats[i + meter].chroma);
            bar_sim_count += 1;
        }
        let bar_sim = if bar_sim_count > 0 {
            bar_sim_sum / bar_sim_count as f64
        } else {
            0.0
        };

        for offset in 0..meter {
            let mut down_sum = 0.0f64;
            let mut down_cnt = 0usize;
            let mut other_sum = 0.0f64;
            let mut other_cnt = 0usize;

            for (i, &acc) in accent.iter().enumerate() {
                if i % meter == offset {
                    down_sum += acc;
                    down_cnt += 1;
                } else {
                    other_sum += acc;
                    other_cnt += 1;
                }
            }

            let contrast = if down_cnt > 0 && other_cnt > 0 {
                (down_sum / down_cnt as f64) - (other_sum / other_cnt as f64)
            } else {
                0.0
            };

            let meter_prior = if meter == 4 { 0.03 } else { 0.0 };
            let score = contrast * 0.65 + bar_sim * 0.35 + meter_prior;
            if score > best_score {
                best_score = score;
                best_meter = meter as u32;
                best_offset = offset;
            }
        }
    }

    (best_meter, best_offset)
}

fn chroma_cosine(a: &[f32; 12], b: &[f32; 12]) -> f64 {
    let mut dot = 0.0f64;
    let mut na = 0.0f64;
    let mut nb = 0.0f64;
    for i in 0..12 {
        let va = a[i] as f64;
        let vb = b[i] as f64;
        dot += va * vb;
        na += va * va;
        nb += vb * vb;
    }
    if na <= 1e-12 && nb <= 1e-12 {
        return 1.0;
    }
    if na <= 1e-12 || nb <= 1e-12 {
        return 0.0;
    }
    (dot / (na * nb).sqrt()).clamp(0.0, 1.0)
}

fn timbre_similarity(a: &BeatFeature, b: &BeatFeature) -> f64 {
    let mut sq = 0.0f64;
    for i in 0..NUM_BANDS {
        let d = (a.log_bands[i] - b.log_bands[i]) as f64;
        sq += d * d;
    }
    let band_sim = (-(sq / NUM_BANDS as f64).sqrt() * 0.65).exp();
    let cent_diff = ((a.centroid - b.centroid).abs() as f64) / (a.centroid.max(b.centroid).max(200.0) as f64);
    let cent_sim = (-cent_diff * 1.4).exp();
    let flat_sim = (1.0 - (a.flatness - b.flatness).abs() as f64).clamp(0.0, 1.0);
    (0.70 * band_sim + 0.20 * cent_sim + 0.10 * flat_sim).clamp(0.0, 1.0)
}

fn energy_similarity(db_a: f32, db_b: f32) -> f64 {
    (-((db_a - db_b).abs() as f64) / 14.0)
        .exp()
        .clamp(0.0, 1.0)
}

fn build_recurrence_matrix(beats: &[BeatFeature]) -> Vec<Vec<f32>> {
    let n = beats.len();
    (0..n)
        .into_par_iter()
        .map(|i| {
            let mut row = vec![0.0f32; n];
            for j in 0..n {
                if i == j {
                    row[j] = 1.0;
                } else {
                    let h = chroma_cosine(&beats[i].chroma, &beats[j].chroma);
                    let t = timbre_similarity(&beats[i], &beats[j]);
                    let e = energy_similarity(beats[i].rms_db, beats[j].rms_db);
                    row[j] = (0.50 * h + 0.30 * t + 0.20 * e) as f32;
                }
            }
            row
        })
        .collect()
}

fn recurrence_path_score(matrix: &[Vec<f32>], a: usize, b: usize, span: usize) -> f64 {
    let n = matrix.len();
    if n == 0 || a >= n || b >= n {
        return 0.0;
    }
    let half = (span / 2).max(1) as isize;
    let mut weighted_sum = 0.0f64;
    let mut weight_total = 0.0f64;

    for k in -half..=half {
        let ia = a as isize + k;
        let ib = b as isize + k;
        if ia >= 0 && ib >= 0 && (ia as usize) < n && (ib as usize) < n {
            let w = 1.0 - (k.abs() as f64) / (half as f64 + 1.5);
            weighted_sum += matrix[ia as usize][ib as usize] as f64 * w;
            weight_total += w;
        }
    }

    if weight_total > 1e-9 {
        (weighted_sum / weight_total).clamp(0.0, 1.0)
    } else {
        matrix[a][b] as f64
    }
}

#[allow(clippy::too_many_arguments)]
fn collect_candidate_pool(
    beats: &[BeatFeature],
    beat_times: &[f64],
    recurrence: &[Vec<f32>],
    beats_per_bar: u32,
    downbeat_offset: usize,
    duration: f64,
    track_peak_rms_db: f32,
    track_is_silent: bool,
) -> Vec<RawCandidate> {
    let n = beats.len();
    let bpb = (beats_per_bar as usize).max(2);
    let min_beats = bpb.min(n.saturating_sub(1)).max(2);
    let min_dur = (duration * 0.15).clamp(0.8, 2.0).min(duration * 0.8);
    let path_span = (bpb * 2).min(8).max(3);
    let quiet_threshold = track_peak_rms_db - 28.0;

    let mut all_candidates = Vec::new();

    for s in 0..n.saturating_sub(min_beats) {
        let s_silent = !track_is_silent && beats[s].rms_db < quiet_threshold;
        for e in (s + min_beats)..n {
            let dur = beat_times[e] - beat_times[s];
            if dur < min_dur {
                continue;
            }

            let e_silent = !track_is_silent && beats[e].rms_db < quiet_threshold;
            let len_beats = e - s;

            let harmony_cur = chroma_cosine(&beats[s].chroma, &beats[e].chroma);
            let harmony_prev = if s > 0 {
                chroma_cosine(&beats[s - 1].chroma, &beats[e - 1].chroma)
            } else {
                harmony_cur
            };
            let harmony = 0.65 * harmony_cur + 0.35 * harmony_prev;

            let timbre_cur = timbre_similarity(&beats[s], &beats[e]);
            let timbre_prev = if s > 0 {
                timbre_similarity(&beats[s - 1], &beats[e - 1])
            } else {
                timbre_cur
            };
            let timbre = 0.65 * timbre_cur + 0.35 * timbre_prev;

            let rec = recurrence_path_score(recurrence, s, e, path_span);

            let bar_aligned = len_beats % bpb == 0;
            let phrase_aligned = len_beats % (bpb * 2) == 0;
            let downbeat_aligned = s % bpb == downbeat_offset;
            let mut rhythm: f64 = 0.35;
            if bar_aligned {
                rhythm += 0.35;
            } else if len_beats % 2 == 0 {
                rhythm += 0.12;
            }
            if downbeat_aligned {
                rhythm += 0.18;
            }
            if phrase_aligned {
                rhythm += 0.12;
            }
            let rhythm = rhythm.clamp(0.0, 1.0);

            let energy_sim = energy_similarity(beats[s].rms_db, beats[e].rms_db);
            let silence_penalty = if s_silent && e_silent {
                0.28
            } else if s_silent || e_silent {
                0.14
            } else {
                0.0
            };

            let musical_score = (0.30 * harmony
                + 0.30 * rec
                + 0.18 * rhythm
                + 0.14 * timbre
                + 0.08 * energy_sim
                - silence_penalty)
                .clamp(0.0, 1.0);

            all_candidates.push(RawCandidate {
                start_beat: s,
                end_beat: e,
                musical_score,
                harmony,
                timbre,
                recurrence: rec,
                rhythm,
                duration_sec: dur,
            });
        }
    }

    if all_candidates.is_empty() {
        return Vec::new();
    }

    all_candidates.sort_by(|a, b| b.musical_score.total_cmp(&a.musical_score));

    let mut chosen_indices: Vec<usize> = Vec::with_capacity(160);
    let mut picked = vec![false; all_candidates.len()];

    let mut take_bucket = |min_frac: f64, max_frac: f64, limit: usize| {
        let mut taken = 0usize;
        for (idx, c) in all_candidates.iter().enumerate() {
            if taken >= limit {
                break;
            }
            if picked[idx] {
                continue;
            }
            let frac = c.duration_sec / duration.max(1e-6);
            if frac >= min_frac && frac < max_frac {
                picked[idx] = true;
                chosen_indices.push(idx);
                taken += 1;
            }
        }
    };

    take_bucket(0.70, 1.01, 50);
    take_bucket(0.45, 0.70, 50);
    take_bucket(0.20, 0.45, 35);

    for idx in 0..all_candidates.len() {
        if chosen_indices.len() >= 160 {
            break;
        }
        if !picked[idx] {
            picked[idx] = true;
            chosen_indices.push(idx);
        }
    }

    chosen_indices
        .into_iter()
        .map(|idx| {
            let c = &all_candidates[idx];
            RawCandidate {
                start_beat: c.start_beat,
                end_beat: c.end_beat,
                musical_score: c.musical_score,
                harmony: c.harmony,
                timbre: c.timbre,
                recurrence: c.recurrence,
                rhythm: c.rhythm,
                duration_sec: c.duration_sec,
            }
        })
        .collect()
}

fn refine_and_score_candidate(
    data: &AudioData,
    raw: &RawCandidate,
    beat_times: &[f64],
    bpm: f64,
    beats_per_bar: u32,
) -> EvaluatedCandidate {
    let sr = data.sample_rate as f64;
    let total_frames = data.frame_count();
    let duration = total_frames as f64 / sr;

    let base_s = (beat_times[raw.start_beat] * sr).round() as isize;
    let base_e = (beat_times[raw.end_beat] * sr).round() as isize;
    let radius = ((0.025 * sr).round() as isize).max(1);
    let coarse_step = ((0.001 * sr).round() as isize).max(1);
    let half_win = ((0.014 * sr).round() as isize).max(8);

    let eval_shift = |delta: isize| -> (f64, f64) {
        let s = base_s + delta;
        let e = base_e + delta;
        if s < 1 || e >= total_frames as isize - 1 || e <= s + 16 {
            return (f64::NEG_INFINITY, 0.0);
        }

        let back = half_win.min(s).min(e);
        let fwd = half_win
            .min(total_frames as isize - s)
            .min(total_frames as isize - e);
        let win_len = (back + fwd) as usize;
        if win_len < 4 {
            return (f64::NEG_INFINITY, 0.0);
        }

        let s_lo = (s - back) as usize;
        let e_lo = (e - back) as usize;
        let su = s as usize;
        let eu = e as usize;

        let mut corr_sum = 0.0f64;
        let mut corr_min = 1.0f64;
        let mut amp_err_sum = 0.0f64;
        let mut slope_err_sum = 0.0f64;
        let mut cut_energy_sum = 0.0f64;

        for ch in &data.channels {
            let a = &ch[e_lo..e_lo + win_len];
            let b = &ch[s_lo..s_lo + win_len];
            let (corr, rms_a, rms_b) = pearson_and_rms(a, b);
            corr_sum += corr;
            if corr < corr_min {
                corr_min = corr;
            }
            let scale = (rms_a + rms_b).max(1e-4);
            let amp_diff = (ch[eu] - ch[su]).abs() as f64 / scale;
            let slope_e = (ch[eu] - ch[eu - 1]) as f64;
            let slope_s = (ch[su] - ch[su - 1]) as f64;
            let slope_diff = (slope_e - slope_s).abs() / scale;
            let cut_amp = (ch[eu].abs() + ch[su].abs()) as f64 * 0.5;

            amp_err_sum += amp_diff;
            slope_err_sum += slope_diff;
            cut_energy_sum += cut_amp;
        }

        let n_ch = data.channels.len() as f64;
        let avg_corr = corr_sum / n_ch;
        let stereo_corr = (0.60 * corr_min + 0.40 * avg_corr).clamp(-1.0, 1.0);
        let phase_unit = (stereo_corr + 1.0) * 0.5;
        let amp_cont = (-(amp_err_sum / n_ch) * 0.8).exp();
        let slope_cont = (-(slope_err_sum / n_ch) * 0.5).exp();
        let quiet_boundary = 1.0 / (1.0 + 4.0 * (cut_energy_sum / n_ch));

        let objective =
            0.55 * phase_unit + 0.20 * amp_cont + 0.15 * slope_cont + 0.10 * quiet_boundary;
        (objective, stereo_corr)
    };

    let mut best_delta = 0isize;
    let mut best_obj = f64::NEG_INFINITY;
    let mut best_corr = 0.0f64;

    let mut d = -radius;
    while d <= radius {
        let (obj, corr) = eval_shift(d);
        if obj > best_obj {
            best_obj = obj;
            best_corr = corr;
            best_delta = d;
        }
        d += coarse_step;
    }

    let fine_radius = (coarse_step + coarse_step / 2).max(4);
    let fine_lo = (best_delta - fine_radius).max(-radius);
    let fine_hi = (best_delta + fine_radius).min(radius);
    for fd in fine_lo..=fine_hi {
        let (obj, corr) = eval_shift(fd);
        if obj > best_obj {
            best_obj = obj;
            best_corr = corr;
            best_delta = fd;
        }
    }

    let s_refined = (base_s + best_delta).clamp(0, total_frames.saturating_sub(2) as isize) as usize;
    let e_refined =
        (base_e + best_delta).clamp(s_refined as isize + 2, total_frames as isize) as usize;
    let musical_period_samples = e_refined - s_refined;
    let musical_period_sec = musical_period_samples as f64 / sr;

    let curve = if best_corr >= 0.55 {
        CrossfadeCurve::ConstantGain
    } else {
        CrossfadeCurve::EqualPower
    };

    let raw_xfade_ms = if best_corr >= 0.85 {
        10.0 + (1.0 - best_corr) / 0.15 * 14.0
    } else if best_corr >= 0.55 {
        24.0 + (0.85 - best_corr) / 0.30 * 26.0
    } else {
        50.0 + (0.55 - best_corr.clamp(-1.0, 0.55)) / 1.55 * 40.0
    };
    let max_xfade_ms = (musical_period_sec * 150.0).clamp(8.0, 90.0);
    let crossfade_ms = (raw_xfade_ms.clamp(8.0, max_xfade_ms)).round();
    let mut fade_samples = ((crossfade_ms / 1000.0) * sr).round() as usize;

    // Extend end by fade_samples so loopDuration == musical_period and overlapping samples stay in phase.
    let (final_start_idx, final_end_idx) = if e_refined + fade_samples <= total_frames {
        (s_refined, e_refined + fade_samples)
    } else {
        let overflow = (e_refined + fade_samples) - total_frames;
        if s_refined >= overflow {
            (s_refined - overflow, total_frames)
        } else {
            let available = total_frames.saturating_sub(e_refined);
            fade_samples = fade_samples.min(available.max((musical_period_samples / 6).max(1)));
            (s_refined, (e_refined + fade_samples).min(total_frames))
        }
    };

    let final_crossfade_ms = ((fade_samples as f64 / sr) * 1000.0).clamp(0.0, 90.0);
    let final_crossfade_ms = (final_crossfade_ms * 10.0).round() / 10.0;
    let final_start = final_start_idx as f64 / sr;
    let final_end = final_end_idx as f64 / sr;
    let loop_duration = ((final_end_idx - final_start_idx).saturating_sub(fade_samples)) as f64 / sr;

    let phase_score = ((best_corr + 1.0) * 0.5).clamp(0.0, 1.0);
    let duration_bonus = (loop_duration / duration.max(1e-6)).clamp(0.0, 1.0) * 0.05;

    let combined = (0.28 * raw.harmony
        + 0.25 * raw.recurrence
        + 0.16 * raw.rhythm
        + 0.21 * phase_score
        + 0.10 * raw.timbre
        + duration_bonus)
        .clamp(0.0, 1.0);

    let confidence = (10.0 + combined * 89.0).round().clamp(1.0, 99.0) as u8;

    let bar_sec = (60.0 / bpm.max(1.0)) * beats_per_bar.max(1) as f64;
    let bars_exact = loop_duration / bar_sec;
    let bars_rounded = bars_exact.round();
    let bars = if bars_rounded >= 1.0 && (bars_exact - bars_rounded).abs() <= 0.18 {
        Some(bars_rounded as u32)
    } else {
        None
    };

    EvaluatedCandidate {
        start: final_start,
        end: final_end,
        loop_duration,
        confidence,
        raw_score: combined,
        crossfade_ms: final_crossfade_ms,
        curve,
        bars,
        diagnostics: CandidateDiagnostics {
            harmony: round3(raw.harmony),
            recurrence: round3(raw.recurrence),
            rhythm: round3(raw.rhythm),
            phase: round3(phase_score),
            timbre: round3(raw.timbre),
        },
    }
}

fn round3(v: f64) -> f64 {
    if v.is_finite() {
        (v.clamp(0.0, 1.0) * 1000.0).round() / 1000.0
    } else {
        0.0
    }
}

fn build_fallback_result(
    duration: f64,
    bpm: f64,
    beats_per_bar: u32,
    beat_times: Vec<f64>,
) -> AnalysisResult {
    let crossfade_ms = ((duration * 40.0).clamp(8.0, 60.0)).round();
    let fade_sec = (crossfade_ms / 1000.0).min(duration * 0.25);
    let loop_duration = (duration - fade_sec).max(0.0);

    AnalysisResult {
        bpm: (bpm * 10.0).round() / 10.0,
        beats_per_bar,
        beat_times,
        candidates: vec![LoopCandidate {
            id: 1,
            start: 0.0,
            end: duration,
            loop_duration,
            confidence: 45,
            crossfade_ms,
            curve: CrossfadeCurve::EqualPower,
            bars: None,
            diagnostics: CandidateDiagnostics {
                harmony: 0.5,
                recurrence: 0.5,
                rhythm: 0.5,
                phase: 0.5,
                timbre: 0.5,
            },
        }],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_result_finite(res: &AnalysisResult) {
        assert!(res.bpm.is_finite(), "bpm must be finite");
        assert!(res.beat_times.iter().all(|t| t.is_finite()));
        assert!(!res.candidates.is_empty(), "must return at least one candidate");
        for c in &res.candidates {
            assert!(c.start.is_finite());
            assert!(c.end.is_finite());
            assert!(c.end > c.start);
            assert!(c.loop_duration.is_finite());
            assert!(c.crossfade_ms.is_finite());
            assert!(c.confidence >= 1 && c.confidence <= 99);
            assert!(c.diagnostics.harmony.is_finite());
            assert!(c.diagnostics.recurrence.is_finite());
            assert!(c.diagnostics.rhythm.is_finite());
            assert!(c.diagnostics.phase.is_finite());
            assert!(c.diagnostics.timbre.is_finite());
        }
    }

    fn make_audio(channels: Vec<Vec<f32>>, sr: u32) -> AudioData {
        let duration = channels[0].len() as f64 / sr as f64;
        AudioData {
            channels,
            sample_rate: sr,
            duration,
            file_name: "synth.wav".to_string(),
            file_path: "synth.wav".to_string(),
            bit_depth: Some(32),
            format_label: "WAV".to_string(),
        }
    }

    #[test]
    fn render_seamless_loop_constant_gain_has_zero_bump_and_continuity() {
        let sr = 44_100u32;
        let dc = vec![0.5f32; sr as usize * 2];
        let rendered_dc = render_seamless_loop(
            &[dc.clone(), dc],
            sr,
            0.2,
            1.6,
            40.0,
            CrossfadeCurve::ConstantGain,
        )
        .expect("render DC");

        for ch in &rendered_dc.channels {
            for &s in ch {
                assert!((s - 0.5).abs() < 1e-5, "unexpected DC bump: {s}");
            }
        }

        // Periodic correlated sine wave: 441 Hz has exact 100-sample period at 44100 Hz.
        let frames = sr as usize * 2;
        let sine: Vec<f32> = (0..frames)
            .map(|i| (2.0 * PI * 441.0 * i as f64 / sr as f64).sin() as f32 * 0.8)
            .collect();
        // Period = 1.0s (44100 samples = 441 cycles); fade = 0.05s; start = 0.2s, end = 1.25s => loop_dur = 1.0s
        let rendered_sine = render_seamless_loop(
            &[sine],
            sr,
            0.2,
            1.25,
            50.0,
            CrossfadeCurve::ConstantGain,
        )
        .expect("render sine");

        let out = &rendered_sine.channels[0];
        let max_step = out
            .windows(2)
            .map(|w| (w[1] - w[0]).abs())
            .fold(0.0f32, f32::max);
        let wrap_step = (out[0] - *out.last().unwrap()).abs();
        let expected_max_slope = (2.0 * PI * 441.0 / sr as f64) as f32 * 0.8 * 1.05;
        assert!(max_step <= expected_max_slope, "internal step too large: {max_step}");
        assert!(wrap_step <= expected_max_slope, "wrap step too large: {wrap_step}");
    }

    #[test]
    fn render_seamless_loop_equal_power_preserves_rms_on_uncorrelated_audio() {
        let sr = 44_100u32;
        let frames = sr as usize * 2;
        let mut sig = vec![0.0f32; frames];
        // Head uses sin(2*pi*500*t), tail uses cos(2*pi*500*t) (orthogonal / quadrature, zero correlation).
        for (i, s) in sig.iter_mut().enumerate() {
            let t = i as f64 / sr as f64;
            *s = if i < frames / 2 {
                (2.0 * PI * 500.0 * t).sin() as f32 * 0.6
            } else {
                (2.0 * PI * 500.0 * t).cos() as f32 * 0.6
            };
        }

        let rendered = render_seamless_loop(
            &[sig],
            sr,
            0.0,
            2.0,
            100.0,
            CrossfadeCurve::EqualPower,
        )
        .expect("render equal power");

        let out = &rendered.channels[0];
        let fade = rendered.fade_samples;
        let xfade_slice = &out[out.len() - fade..];
        let xfade_rms = (xfade_slice
            .iter()
            .map(|&v| (v as f64) * (v as f64))
            .sum::<f64>()
            / xfade_slice.len() as f64)
            .sqrt();
        let expected_rms = 0.6 / 2.0f64.sqrt();
        assert!(
            (xfade_rms - expected_rms).abs() < 0.03,
            "equal power RMS drifted: got {xfade_rms}, expected {expected_rms}"
        );
    }

    #[test]
    fn compute_seam_preview_and_snap_to_zero_crossing() {
        let sr = 44_100u32;
        let frames = sr as usize * 2;
        let sine: Vec<f32> = (0..frames)
            .map(|i| (2.0 * PI * 441.0 * i as f64 / sr as f64).sin() as f32 * 0.7)
            .collect();

        let preview = compute_seam_preview(
            &[sine.clone(), sine.clone()],
            sr,
            0.2,
            1.24,
            40.0,
            CrossfadeCurve::ConstantGain,
        )
        .expect("seam preview");

        assert_eq!(preview.tail.len(), SEAM_PREVIEW_POINTS);
        assert_eq!(preview.head.len(), SEAM_PREVIEW_POINTS);
        assert_eq!(preview.blended.len(), SEAM_PREVIEW_POINTS);
        assert!(preview.crossfade_start_ratio > 0.0);
        assert!(preview.crossfade_end_ratio < 1.0);
        assert!(preview.crossfade_end_ratio > preview.crossfade_start_ratio);
        assert!(preview.phase_correlation > 0.95);
        assert!(preview.seam_continuity > 0.90);
        assert!((preview.loop_duration - 1.0).abs() < 1e-3);

        // Snap near t = 0.5005s (just past a zero crossing of 441 Hz sine)
        let snapped = snap_to_zero_crossing(&[sine.clone()], sr, 0.5005);
        assert!((snapped - 0.5005).abs() <= 0.0155);
        let idx = (snapped * sr as f64).round() as usize;
        assert!(sine[idx - 1] <= 0.0 && sine[idx] > 0.0);
    }

    #[test]
    fn find_musical_loops_handles_silence_and_silent_margins_without_nan() {
        let sr = 44_100u32;
        let cancel = AtomicBool::new(false);

        // 1) Pure all-zero stereo audio
        let silent = make_audio(vec![vec![0.0; sr as usize * 8]; 2], sr);
        let res_silent = find_musical_loops(&silent, &cancel, &|_, _| {}).expect("silent ok");
        assert_result_finite(&res_silent);

        // 2) Track with 2s silent intro + 8s rhythmic chords + 2s silent outro
        let total = sr as usize * 12;
        let mut ch = vec![0.0f32; total];
        let beat_sec = 0.5;
        for i in (sr as usize * 2)..(sr as usize * 10) {
            let t = (i - sr as usize * 2) as f64 / sr as f64;
            let in_beat = t % beat_sec;
            let env = (-in_beat * 14.0).exp();
            let bar = ((t / (beat_sec * 4.0)).floor() as usize) % 2;
            let f0 = if bar == 0 { 220.0 } else { 261.63 };
            ch[i] = ((2.0 * PI * f0 * t).sin() * 0.4 + (2.0 * PI * 65.0 * t).sin() * env * 0.5)
                as f32;
        }
        let margined = make_audio(vec![ch.clone(), ch], sr);
        let res_margined =
            find_musical_loops(&margined, &cancel, &|_, _| {}).expect("margined ok");
        assert_result_finite(&res_margined);
    }

    #[test]
    fn find_musical_loops_tracks_fractional_123_5_bpm_without_drift() {
        let sr = 44_100u32;
        let bpm_true = 123.5f64;
        let beat_sec = 60.0 / bpm_true;
        let bar_sec = beat_sec * 4.0;
        let phrase_sec = bar_sec * 4.0; // 4-bar phrase ≈ 7.7733s
        let duration_sec = 24.0;
        let total = (duration_sec * sr as f64).round() as usize;

        // 4-bar chord progression repeating identically every phrase_sec
        let chords: [[f64; 3]; 4] = [
            [220.0, 261.63, 329.63], // Am
            [174.61, 220.0, 261.63], // F
            [261.63, 329.63, 392.00], // C
            [196.00, 246.94, 293.66], // G
        ];

        let mut left = vec![0.0f32; total];
        let mut right = vec![0.0f32; total];

        for i in 0..total {
            let t = i as f64 / sr as f64;
            let t_phrase = t % phrase_sec;
            let beat_idx = (t_phrase / beat_sec).floor() as usize;
            let in_beat = t_phrase - beat_idx as f64 * beat_sec;
            let bar_idx = (beat_idx / 4) % 4;
            let beat_in_bar = beat_idx % 4;

            // Sharp kick/percussion transient on every beat, louder on downbeat
            let kick_amp = if beat_in_bar == 0 { 0.55 } else { 0.34 };
            let kick_env = (-in_beat * 28.0).exp();
            let kick_freq = 55.0 + 110.0 * (-in_beat * 45.0).exp();
            let kick = (2.0 * PI * kick_freq * in_beat).sin() * kick_env * kick_amp;

            // Harmonic chord locked to phrase phase so repeated phrases are sample-phase-aligned
            let chord_env = 0.35 + 0.65 * (-in_beat * 4.0).exp();
            let chord = chords[bar_idx];
            let mut pad_l = 0.0;
            let mut pad_r = 0.0;
            for (k, &freq) in chord.iter().enumerate() {
                let ph = 2.0 * PI * freq * t_phrase;
                pad_l += ph.sin() * (0.14 - k as f64 * 0.015);
                pad_r += (ph + 0.25 * (k as f64 + 1.0)).sin() * (0.14 - k as f64 * 0.015);
            }

            left[i] = (kick + pad_l * chord_env).clamp(-0.98, 0.98) as f32;
            right[i] = (kick + pad_r * chord_env).clamp(-0.98, 0.98) as f32;
        }

        let audio = make_audio(vec![left, right], sr);
        let cancel = AtomicBool::new(false);
        let result = find_musical_loops(&audio, &cancel, &|_, _| {}).expect("analysis ok");
        assert_result_finite(&result);

        assert!(
            (result.bpm - bpm_true).abs() <= 1.5,
            "expected BPM near {bpm_true}, got {}",
            result.bpm
        );
        assert_eq!(result.beats_per_bar, 4, "expected 4/4 meter");

        let best = &result.candidates[0];
        let phrases = (best.loop_duration / phrase_sec).round().max(1.0);
        let expected_dur = phrases * phrase_sec;
        assert!(
            (best.loop_duration - expected_dur).abs() <= 0.15,
            "expected loop duration near {expected_dur:.3}s (phrases={phrases}), got {:.3}s",
            best.loop_duration
        );
        assert!(
            best.confidence >= 70,
            "expected high confidence on periodic track, got {}",
            best.confidence
        );
    }

    #[test]
    fn find_musical_loops_respects_cancellation() {
        let sr = 44_100u32;
        let audio = make_audio(vec![vec![0.1; sr as usize * 4]], sr);
        let cancel = AtomicBool::new(true);
        let res = find_musical_loops(&audio, &cancel, &|_, _| {});
        assert!(matches!(res, Err(AppError::Cancelled)));
    }
}
