pub mod audio_io;
pub mod dsp;
pub mod error;
pub mod playback;

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};

use crate::audio_io::{
    AudioData, AudioSummary, DEFAULT_WAVEFORM_BUCKETS, WavFormat, decode_audio_file,
    export_wav as write_wav_file, trim_audio,
};
use crate::dsp::{
    AnalysisResult, CrossfadeCurve, RenderedLoop, SeamPreviewData, compute_seam_preview,
    find_musical_loops, render_seamless_loop, snap_to_zero_crossing as dsp_snap_to_zero_crossing,
};
use crate::error::AppError;
use crate::playback::{PlaybackController, PlaybackMode, PlaybackState};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnalysisProgressEvent {
    progress: f32,
    stage: String,
}

pub struct AppState {
    pub pending_audio: Mutex<Option<Arc<AudioData>>>,
    pub active_audio: Mutex<Option<Arc<AudioData>>>,
    pub rendered_loop: Mutex<Option<Arc<RenderedLoop>>>,
    pub analysis_cancel: Arc<AtomicBool>,
    pub playback: PlaybackController,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            pending_audio: Mutex::new(None),
            active_audio: Mutex::new(None),
            rendered_loop: Mutex::new(None),
            analysis_cancel: Arc::new(AtomicBool::new(false)),
            playback: PlaybackController::new(),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

#[tauri::command]
async fn load_audio(path: String, state: State<'_, AppState>) -> Result<AudioSummary, AppError> {
    state.playback.pause();
    let path_for_decode = path.clone();
    let decoded = tauri::async_runtime::spawn_blocking(move || {
        decode_audio_file(Path::new(&path_for_decode))
    })
    .await
    .map_err(|err| AppError::Internal(format!("Поток декодирования прерван: {err}")))??;

    let decoded = Arc::new(decoded);
    let summary = decoded.summary(DEFAULT_WAVEFORM_BUCKETS);
    *state
        .pending_audio
        .lock()
        .map_err(|_| AppError::Internal("Не удалось заблокировать pending_audio".to_string()))? =
        Some(decoded);
    Ok(summary)
}

#[tauri::command]
fn apply_trim(
    start_sec: f64,
    end_sec: f64,
    state: State<'_, AppState>,
) -> Result<AudioSummary, AppError> {
    state.playback.reset();

    let source = {
        let pending = state
            .pending_audio
            .lock()
            .map_err(|_| AppError::Internal("Lock error".to_string()))?
            .clone();
        match pending {
            Some(audio) => audio,
            None => state
                .active_audio
                .lock()
                .map_err(|_| AppError::Internal("Lock error".to_string()))?
                .clone()
                .ok_or(AppError::NoPendingAudio)?,
        }
    };

    let trimmed = Arc::new(trim_audio(&source, start_sec, end_sec)?);
    let summary = trimmed.summary(DEFAULT_WAVEFORM_BUCKETS);

    *state
        .active_audio
        .lock()
        .map_err(|_| AppError::Internal("Lock error".to_string()))? = Some(trimmed);
    *state
        .pending_audio
        .lock()
        .map_err(|_| AppError::Internal("Lock error".to_string()))? = None;
    *state
        .rendered_loop
        .lock()
        .map_err(|_| AppError::Internal("Lock error".to_string()))? = None;

    Ok(summary)
}

#[tauri::command]
fn cancel_trim(state: State<'_, AppState>) -> Result<(), AppError> {
    if state.playback.get_state().mode == PlaybackMode::Trim {
        state.playback.pause();
    }
    *state
        .pending_audio
        .lock()
        .map_err(|_| AppError::Internal("Lock error".to_string()))? = None;
    Ok(())
}

#[tauri::command]
fn clear_audio(state: State<'_, AppState>) -> Result<(), AppError> {
    state.analysis_cancel.store(true, Ordering::SeqCst);
    state.playback.reset();
    *state
        .pending_audio
        .lock()
        .map_err(|_| AppError::Internal("Lock error".to_string()))? = None;
    *state
        .active_audio
        .lock()
        .map_err(|_| AppError::Internal("Lock error".to_string()))? = None;
    *state
        .rendered_loop
        .lock()
        .map_err(|_| AppError::Internal("Lock error".to_string()))? = None;
    Ok(())
}

#[tauri::command]
async fn analyze_loops(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<AnalysisResult, AppError> {
    let audio = state
        .active_audio
        .lock()
        .map_err(|_| AppError::Internal("Lock error".to_string()))?
        .clone()
        .ok_or(AppError::NoAudioLoaded)?;

    state.analysis_cancel.store(false, Ordering::SeqCst);
    let cancel = Arc::clone(&state.analysis_cancel);

    tauri::async_runtime::spawn_blocking(move || {
        find_musical_loops(&audio, &cancel, &|progress, stage| {
            let _ = app.emit(
                "analysis-progress",
                AnalysisProgressEvent {
                    progress,
                    stage: stage.to_string(),
                },
            );
        })
    })
    .await
    .map_err(|err| AppError::Internal(format!("Поток анализа прерван: {err}")))?
}

#[tauri::command]
fn cancel_analysis(state: State<'_, AppState>) -> Result<(), AppError> {
    state.analysis_cancel.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
fn update_loop_params(
    start_sec: f64,
    end_sec: f64,
    crossfade_ms: f64,
    curve: CrossfadeCurve,
    state: State<'_, AppState>,
) -> Result<SeamPreviewData, AppError> {
    let audio = state
        .active_audio
        .lock()
        .map_err(|_| AppError::Internal("Lock error".to_string()))?
        .clone()
        .ok_or(AppError::NoAudioLoaded)?;

    let rendered = Arc::new(render_seamless_loop(
        &audio.channels,
        audio.sample_rate,
        start_sec,
        end_sec,
        crossfade_ms,
        curve,
    )?);

    let preview = compute_seam_preview(
        &audio.channels,
        audio.sample_rate,
        start_sec,
        end_sec,
        crossfade_ms,
        curve,
    )?;

    *state
        .rendered_loop
        .lock()
        .map_err(|_| AppError::Internal("Lock error".to_string()))? = Some(Arc::clone(&rendered));

    state.playback.update_loop_buffer(rendered);
    Ok(preview)
}

#[tauri::command]
fn snap_to_zero_crossing(
    time_sec: f64,
    is_end: bool,
    state: State<'_, AppState>,
) -> Result<f64, AppError> {
    let audio = {
        let active = state
            .active_audio
            .lock()
            .map_err(|_| AppError::Internal("Lock error".to_string()))?
            .clone();
        match active {
            Some(a) => a,
            None => state
                .pending_audio
                .lock()
                .map_err(|_| AppError::Internal("Lock error".to_string()))?
                .clone()
                .ok_or(AppError::NoAudioLoaded)?,
        }
    };

    let snapped = dsp_snap_to_zero_crossing(&audio.channels, audio.sample_rate, time_sec);
    let min_val = if is_end {
        1.0 / audio.sample_rate.max(1) as f64
    } else {
        0.0
    };
    Ok(snapped.clamp(min_val, audio.duration))
}

#[tauri::command]
fn play_loop(
    start_from_sec: Option<f64>,
    state: State<'_, AppState>,
) -> Result<PlaybackState, AppError> {
    let rendered = state
        .rendered_loop
        .lock()
        .map_err(|_| AppError::Internal("Lock error".to_string()))?
        .clone()
        .ok_or(AppError::NoLoopRendered)?;

    Ok(state.playback.play_loop(rendered, start_from_sec))
}

#[tauri::command]
fn audition_seam(
    lead_seconds: f64,
    state: State<'_, AppState>,
) -> Result<PlaybackState, AppError> {
    let rendered = state
        .rendered_loop
        .lock()
        .map_err(|_| AppError::Internal("Lock error".to_string()))?
        .clone()
        .ok_or(AppError::NoLoopRendered)?;

    Ok(state.playback.audition_seam(rendered, lead_seconds))
}

#[tauri::command]
fn play_trim_preview(
    start_sec: f64,
    end_sec: f64,
    from_sec: Option<f64>,
    state: State<'_, AppState>,
) -> Result<PlaybackState, AppError> {
    let audio = {
        let pending = state
            .pending_audio
            .lock()
            .map_err(|_| AppError::Internal("Lock error".to_string()))?
            .clone();
        match pending {
            Some(a) => a,
            None => state
                .active_audio
                .lock()
                .map_err(|_| AppError::Internal("Lock error".to_string()))?
                .clone()
                .ok_or(AppError::NoPendingAudio)?,
        }
    };

    if !start_sec.is_finite() || !end_sec.is_finite() || end_sec <= start_sec {
        return Err(AppError::InvalidRange(
            "Некорректный диапазон предпрослушивания".to_string(),
        ));
    }

    Ok(state
        .playback
        .play_trim_preview(audio, start_sec, end_sec, from_sec))
}

#[tauri::command]
fn pause_playback(state: State<'_, AppState>) -> Result<PlaybackState, AppError> {
    Ok(state.playback.pause())
}

#[tauri::command]
fn seek_playback(
    position_sec: f64,
    state: State<'_, AppState>,
) -> Result<PlaybackState, AppError> {
    Ok(state.playback.seek(position_sec))
}

#[tauri::command]
fn get_playback_state(state: State<'_, AppState>) -> Result<PlaybackState, AppError> {
    Ok(state.playback.get_state())
}

#[tauri::command]
fn set_playback_volume(volume: f32, state: State<'_, AppState>) -> Result<f32, AppError> {
    Ok(state.playback.set_volume(volume))
}

#[tauri::command]
fn export_wav(
    output_path: String,
    format: WavFormat,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let maybe_loop = state
        .rendered_loop
        .lock()
        .map_err(|_| AppError::Internal("Lock error".to_string()))?
        .clone();

    if let Some(rendered) = maybe_loop {
        write_wav_file(
            Path::new(&output_path),
            &rendered.channels,
            rendered.sample_rate,
            format,
        )?;
        return Ok(output_path);
    }

    let active = state
        .active_audio
        .lock()
        .map_err(|_| AppError::Internal("Lock error".to_string()))?
        .clone()
        .ok_or(AppError::NoLoopRendered)?;

    write_wav_file(
        Path::new(&output_path),
        &active.channels,
        active.sample_rate,
        format,
    )?;
    Ok(output_path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            load_audio,
            apply_trim,
            cancel_trim,
            clear_audio,
            analyze_loops,
            cancel_analysis,
            update_loop_params,
            snap_to_zero_crossing,
            play_loop,
            audition_seam,
            play_trim_preview,
            pause_playback,
            seek_playback,
            get_playback_state,
            set_playback_volume,
            export_wav,
        ])
        .build(tauri::generate_context!())
        .expect("error while building SeamForge application");

    app.run(|app_handle, event| match event {
        RunEvent::WindowEvent {
            event: tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed,
            ..
        }
        | RunEvent::ExitRequested { .. }
        | RunEvent::Exit => {
            let state = app_handle.state::<AppState>();
            state.analysis_cancel.store(true, Ordering::SeqCst);
            state.playback.shutdown();
            std::process::exit(0);
        }
        _ => {}
    });
}
