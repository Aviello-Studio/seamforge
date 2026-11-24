use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::thread::{self, JoinHandle};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, OutputCallbackInfo, SampleFormat, SizedSample, Stream, StreamConfig};
use serde::Serialize;

use crate::audio_io::AudioData;
use crate::dsp::RenderedLoop;
use crate::error::AppError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PlaybackMode {
    Idle,
    Loop,
    Trim,
}

impl PlaybackMode {
    fn to_u8(self) -> u8 {
        match self {
            PlaybackMode::Idle => 0,
            PlaybackMode::Loop => 1,
            PlaybackMode::Trim => 2,
        }
    }

    fn from_u8(v: u8) -> Self {
        match v {
            1 => PlaybackMode::Loop,
            2 => PlaybackMode::Trim,
            _ => PlaybackMode::Idle,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackState {
    pub playing: bool,
    pub mode: PlaybackMode,
    pub position_sec: f64,
    pub loop_offset_sec: f64,
    pub loop_duration_sec: f64,
    pub audio_available: bool,
}

struct PlaybackAtomics {
    playing: AtomicBool,
    mode: AtomicU8,
    position_bits: AtomicU64,
    loop_offset_bits: AtomicU64,
    loop_duration_bits: AtomicU64,
    volume_bits: AtomicU32,
    audio_available: AtomicBool,
}

impl PlaybackAtomics {
    fn new() -> Self {
        Self {
            playing: AtomicBool::new(false),
            mode: AtomicU8::new(PlaybackMode::Idle.to_u8()),
            position_bits: AtomicU64::new(0.0f64.to_bits()),
            loop_offset_bits: AtomicU64::new(0.0f64.to_bits()),
            loop_duration_bits: AtomicU64::new(0.0f64.to_bits()),
            volume_bits: AtomicU32::new(0.85f32.to_bits()),
            audio_available: AtomicBool::new(false),
        }
    }

    fn volume(&self) -> f32 {
        f32::from_bits(self.volume_bits.load(Ordering::Relaxed)).clamp(0.0, 1.0)
    }

    fn set_volume(&self, volume: f32) -> f32 {
        let clamped = if volume.is_finite() {
            volume.clamp(0.0, 1.0)
        } else {
            0.85
        };
        self.volume_bits.store(clamped.to_bits(), Ordering::Relaxed);
        clamped
    }

    fn snapshot(&self) -> PlaybackState {
        PlaybackState {
            playing: self.playing.load(Ordering::Relaxed),
            mode: PlaybackMode::from_u8(self.mode.load(Ordering::Relaxed)),
            position_sec: f64::from_bits(self.position_bits.load(Ordering::Relaxed)),
            loop_offset_sec: f64::from_bits(self.loop_offset_bits.load(Ordering::Relaxed)),
            loop_duration_sec: f64::from_bits(self.loop_duration_bits.load(Ordering::Relaxed)),
            audio_available: self.audio_available.load(Ordering::Relaxed),
        }
    }

    fn store_all(
        &self,
        playing: bool,
        mode: PlaybackMode,
        position_sec: f64,
        loop_offset_sec: f64,
        loop_duration_sec: f64,
    ) {
        self.playing.store(playing, Ordering::Relaxed);
        self.mode.store(mode.to_u8(), Ordering::Relaxed);
        self.position_bits
            .store(position_sec.to_bits(), Ordering::Relaxed);
        self.loop_offset_bits
            .store(loop_offset_sec.to_bits(), Ordering::Relaxed);
        self.loop_duration_bits
            .store(loop_duration_sec.to_bits(), Ordering::Relaxed);
    }
}

enum CallbackCommand {
    PlayLoop {
        buffer: Arc<RenderedLoop>,
        start_from_sec: Option<f64>,
    },
    UpdateLoopBuffer {
        buffer: Arc<RenderedLoop>,
    },
    AuditionSeam {
        buffer: Arc<RenderedLoop>,
        lead_seconds: f64,
    },
    PlayTrim {
        audio: Arc<AudioData>,
        start_sec: f64,
        end_sec: f64,
        from_sec: Option<f64>,
    },
    Pause,
    Seek {
        position_sec: f64,
    },
    Reset,
}

enum ControllerCommand {
    Forward(CallbackCommand),
    Shutdown,
}

pub struct PlaybackController {
    tx: mpsc::Sender<ControllerCommand>,
    atomics: Arc<PlaybackAtomics>,
    thread_handle: Mutex<Option<JoinHandle<()>>>,
}

impl PlaybackController {
    pub fn new() -> Self {
        let atomics = Arc::new(PlaybackAtomics::new());
        let (tx, rx) = mpsc::channel::<ControllerCommand>();
        let (ready_tx, ready_rx) = mpsc::channel::<()>();
        let atomics_bg = Arc::clone(&atomics);

        let handle = thread::Builder::new()
            .name("seamforge-audio".to_string())
            .spawn(move || {
                audio_controller_loop(rx, atomics_bg, ready_tx);
            })
            .ok();

        let _ = ready_rx.recv();

        Self {
            tx,
            atomics,
            thread_handle: Mutex::new(handle),
        }
    }

    pub fn get_state(&self) -> PlaybackState {
        self.atomics.snapshot()
    }

    pub fn play_loop(
        &self,
        buffer: Arc<RenderedLoop>,
        start_from_sec: Option<f64>,
    ) -> PlaybackState {
        if !self.atomics.audio_available.load(Ordering::Relaxed) {
            return self.atomics.snapshot();
        }
        let offset = match start_from_sec {
            Some(pos_sec) => source_sec_to_loop_offset(&buffer, pos_sec),
            None => {
                let st = self.atomics.snapshot();
                if st.mode == PlaybackMode::Loop && st.loop_offset_sec < buffer.duration {
                    st.loop_offset_sec.max(0.0)
                } else {
                    0.0
                }
            }
        };
        let pos_sec = loop_offset_to_source_sec(&buffer, offset);
        self.atomics
            .store_all(true, PlaybackMode::Loop, pos_sec, offset, buffer.duration);
        let _ = self.tx.send(ControllerCommand::Forward(CallbackCommand::PlayLoop {
            buffer,
            start_from_sec,
        }));
        self.atomics.snapshot()
    }

    pub fn update_loop_buffer(&self, buffer: Arc<RenderedLoop>) {
        let st = self.atomics.snapshot();
        if st.mode == PlaybackMode::Loop {
            let offset = if buffer.duration > 0.0 {
                st.loop_offset_sec.rem_euclid(buffer.duration)
            } else {
                0.0
            };
            let pos = loop_offset_to_source_sec(&buffer, offset);
            self.atomics.store_all(
                st.playing,
                PlaybackMode::Loop,
                pos,
                offset,
                buffer.duration,
            );
        } else {
            self.atomics
                .loop_duration_bits
                .store(buffer.duration.to_bits(), Ordering::Relaxed);
        }
        let _ = self
            .tx
            .send(ControllerCommand::Forward(CallbackCommand::UpdateLoopBuffer { buffer }));
    }

    pub fn audition_seam(&self, buffer: Arc<RenderedLoop>, lead_seconds: f64) -> PlaybackState {
        if !self.atomics.audio_available.load(Ordering::Relaxed) {
            return self.atomics.snapshot();
        }
        let offset = compute_audition_offset(&buffer, lead_seconds);
        let pos = loop_offset_to_source_sec(&buffer, offset);
        self.atomics
            .store_all(true, PlaybackMode::Loop, pos, offset, buffer.duration);
        let _ = self
            .tx
            .send(ControllerCommand::Forward(CallbackCommand::AuditionSeam {
                buffer,
                lead_seconds,
            }));
        self.atomics.snapshot()
    }

    pub fn play_trim_preview(
        &self,
        audio: Arc<AudioData>,
        start_sec: f64,
        end_sec: f64,
        from_sec: Option<f64>,
    ) -> PlaybackState {
        if !self.atomics.audio_available.load(Ordering::Relaxed) {
            return self.atomics.snapshot();
        }
        let s = start_sec.clamp(0.0, audio.duration);
        let e = end_sec.clamp(s, audio.duration);
        let dur = (e - s).max(0.0);
        let pos = match from_sec {
            Some(f) if f >= s && f < e => f,
            _ => s,
        };
        self.atomics
            .store_all(true, PlaybackMode::Trim, pos, (pos - s).max(0.0), dur);
        let _ = self
            .tx
            .send(ControllerCommand::Forward(CallbackCommand::PlayTrim {
                audio,
                start_sec: s,
                end_sec: e,
                from_sec,
            }));
        self.atomics.snapshot()
    }

    pub fn pause(&self) -> PlaybackState {
        self.atomics.playing.store(false, Ordering::Relaxed);
        let _ = self.tx.send(ControllerCommand::Forward(CallbackCommand::Pause));
        self.atomics.snapshot()
    }

    pub fn seek(&self, position_sec: f64) -> PlaybackState {
        let clamped = if position_sec.is_finite() {
            position_sec.max(0.0)
        } else {
            0.0
        };
        self.atomics
            .position_bits
            .store(clamped.to_bits(), Ordering::Relaxed);
        let _ = self
            .tx
            .send(ControllerCommand::Forward(CallbackCommand::Seek {
                position_sec: clamped,
            }));
        self.atomics.snapshot()
    }

    pub fn set_volume(&self, volume: f32) -> f32 {
        self.atomics.set_volume(volume)
    }

    pub fn reset(&self) {
        self.atomics
            .store_all(false, PlaybackMode::Idle, 0.0, 0.0, 0.0);
        let _ = self.tx.send(ControllerCommand::Forward(CallbackCommand::Reset));
    }

    pub fn shutdown(&self) {
        self.atomics.playing.store(false, Ordering::Relaxed);
        let _ = self.tx.send(ControllerCommand::Shutdown);
        if let Ok(mut guard) = self.thread_handle.lock()
            && let Some(handle) = guard.take()
        {
            // Give the audio controller thread a brief window to pause and drop the WASAPI
            // stream cleanly without ever hanging app exit if the audio driver stalls.
            let deadline = std::time::Instant::now() + std::time::Duration::from_millis(350);
            while !handle.is_finished() && std::time::Instant::now() < deadline {
                thread::sleep(std::time::Duration::from_millis(10));
            }
            if handle.is_finished() {
                let _ = handle.join();
            }
        }
    }
}

impl Default for PlaybackController {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for PlaybackController {
    fn drop(&mut self) {
        self.shutdown();
    }
}

pub fn loop_offset_to_source_sec(buffer: &RenderedLoop, loop_offset_sec: f64) -> f64 {
    if buffer.duration <= 0.0 {
        return buffer.source_start_sec;
    }
    let fade_sec = buffer.fade_samples as f64 / buffer.sample_rate.max(1) as f64;
    let offset = loop_offset_sec.rem_euclid(buffer.duration);
    (buffer.source_start_sec + fade_sec + offset).clamp(buffer.source_start_sec, buffer.source_end_sec)
}

pub fn source_sec_to_loop_offset(buffer: &RenderedLoop, position_sec: f64) -> f64 {
    if buffer.duration <= 0.0 {
        return 0.0;
    }
    let fade_sec = buffer.fade_samples as f64 / buffer.sample_rate.max(1) as f64;
    let body_dur = (buffer.duration - fade_sec).max(0.0);
    let p = position_sec.clamp(buffer.source_start_sec, buffer.source_end_sec);
    let body_start_sec = buffer.source_start_sec + fade_sec;
    if p >= body_start_sec {
        (p - body_start_sec).clamp(0.0, buffer.duration)
    } else {
        (body_dur + (p - buffer.source_start_sec)).clamp(0.0, buffer.duration)
    }
}

fn perceptual_gain(volume: f32) -> f32 {
    let v = volume.clamp(0.0, 1.0);
    // Slight perceptual taper (~x^1.6) so low slider positions have natural studio resolution
    v.powf(1.6)
}

fn compute_audition_offset(buffer: &RenderedLoop, lead_seconds: f64) -> f64 {
    if buffer.duration <= 0.0 {
        return 0.0;
    }
    let lead = lead_seconds.max(0.1).min(buffer.duration * 0.45);
    (buffer.duration - lead).max(0.0)
}

fn audio_controller_loop(
    rx: mpsc::Receiver<ControllerCommand>,
    atomics: Arc<PlaybackAtomics>,
    ready_tx: mpsc::Sender<()>,
) {
    let (cb_tx, cb_rx) = mpsc::channel::<CallbackCommand>();
    let stream = match create_output_stream(cb_rx, Arc::clone(&atomics)) {
        Ok(s) => {
            atomics.audio_available.store(true, Ordering::Relaxed);
            Some(s)
        }
        Err(_) => {
            atomics.audio_available.store(false, Ordering::Relaxed);
            None
        }
    };

    let _ = ready_tx.send(());

    while let Ok(cmd) = rx.recv() {
        match cmd {
            ControllerCommand::Forward(cb_cmd) => {
                if stream.is_some() {
                    let _ = cb_tx.send(cb_cmd);
                }
            }
            ControllerCommand::Shutdown => break,
        }
    }

    if let Some(s) = stream {
        let _ = s.pause();
        drop(s);
    }
}

fn create_output_stream(
    cb_rx: mpsc::Receiver<CallbackCommand>,
    atomics: Arc<PlaybackAtomics>,
) -> Result<Stream, AppError> {
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or_else(|| AppError::AudioDevice("Аудиоустройство вывода не найдено".to_string()))?;
    let supported = device
        .default_output_config()
        .map_err(|err| AppError::AudioDevice(err.to_string()))?;
    let sample_format = supported.sample_format();
    let config: StreamConfig = supported.into();

    let stream = match sample_format {
        SampleFormat::F32 => build_typed_stream::<f32>(&device, config, cb_rx, atomics)?,
        SampleFormat::I16 => build_typed_stream::<i16>(&device, config, cb_rx, atomics)?,
        SampleFormat::U16 => build_typed_stream::<u16>(&device, config, cb_rx, atomics)?,
        SampleFormat::I32 => build_typed_stream::<i32>(&device, config, cb_rx, atomics)?,
        SampleFormat::F64 => build_typed_stream::<f64>(&device, config, cb_rx, atomics)?,
        other => {
            return Err(AppError::AudioDevice(format!(
                "Неподдерживаемый формат вывода: {other:?}"
            )));
        }
    };

    stream
        .play()
        .map_err(|err| AppError::AudioDevice(err.to_string()))?;
    Ok(stream)
}

fn build_typed_stream<T>(
    device: &cpal::Device,
    config: StreamConfig,
    cb_rx: mpsc::Receiver<CallbackCommand>,
    atomics: Arc<PlaybackAtomics>,
) -> Result<Stream, AppError>
where
    T: SizedSample + FromSample<f32>,
{
    let device_sr = config.sample_rate as f64;
    let out_channels = (config.channels as usize).max(1);
    let mut engine = AudioEngineState::new(device_sr, out_channels, atomics);

    device
        .build_output_stream(
            config,
            move |data: &mut [T], _info: &OutputCallbackInfo| {
                while let Ok(cmd) = cb_rx.try_recv() {
                    engine.handle_command(cmd);
                }
                engine.render(data);
            },
            |_err: cpal::Error| {},
            None,
        )
        .map_err(|err| AppError::AudioDevice(err.to_string()))
}

struct AudioEngineState {
    device_sr: f64,
    out_channels: usize,
    fade_len: usize,
    atomics: Arc<PlaybackAtomics>,

    mode: PlaybackMode,
    playing: bool,
    pausing: bool,

    loop_buf: Option<Arc<RenderedLoop>>,
    trim_audio: Option<Arc<AudioData>>,
    trim_start_idx: usize,
    trim_end_idx: usize,
    trim_start_sec: f64,
    trim_end_sec: f64,

    src_pos: f64,

    gain_ramp: f32,
    gain_step: f32,
    smoothed_volume: f32,
    xfade_remaining: usize,
    prev_out: Vec<f32>,
    xfade_hold: Vec<f32>,
}

impl AudioEngineState {
    fn new(device_sr: f64, out_channels: usize, atomics: Arc<PlaybackAtomics>) -> Self {
        let fade_len = ((0.004 * device_sr).round() as usize).max(1);
        let init_vol = perceptual_gain(atomics.volume());
        Self {
            device_sr,
            out_channels,
            fade_len,
            atomics,
            mode: PlaybackMode::Idle,
            playing: false,
            pausing: false,
            loop_buf: None,
            trim_audio: None,
            trim_start_idx: 0,
            trim_end_idx: 0,
            trim_start_sec: 0.0,
            trim_end_sec: 0.0,
            src_pos: 0.0,
            gain_ramp: 0.0,
            gain_step: 1.0 / fade_len as f32,
            smoothed_volume: init_vol,
            xfade_remaining: 0,
            prev_out: vec![0.0; out_channels],
            xfade_hold: vec![0.0; out_channels],
        }
    }

    fn trigger_continuity_fade(&mut self) {
        self.xfade_hold.copy_from_slice(&self.prev_out);
        self.xfade_remaining = self.fade_len;
    }

    fn handle_command(&mut self, cmd: CallbackCommand) {
        match cmd {
            CallbackCommand::PlayLoop {
                buffer,
                start_from_sec,
            } => {
                let was_playing = self.playing && !self.pausing;
                let loop_frames = buffer.channels.first().map_or(0, Vec::len);
                if loop_frames == 0 {
                    self.playing = false;
                    self.pausing = false;
                    self.mode = PlaybackMode::Idle;
                    self.publish_atomics();
                    return;
                }

                let target_offset_sec = match start_from_sec {
                    Some(pos) => source_sec_to_loop_offset(&buffer, pos),
                    None => {
                        if self.mode == PlaybackMode::Loop {
                            let cur_sec = self.src_pos / buffer.sample_rate as f64;
                            if cur_sec.is_finite() && cur_sec < buffer.duration {
                                cur_sec.max(0.0)
                            } else {
                                0.0
                            }
                        } else {
                            0.0
                        }
                    }
                };

                self.src_pos = (target_offset_sec * buffer.sample_rate as f64)
                    .rem_euclid(loop_frames as f64);
                self.loop_buf = Some(buffer);
                self.mode = PlaybackMode::Loop;
                self.playing = true;
                self.pausing = false;

                if was_playing {
                    self.trigger_continuity_fade();
                    self.gain_ramp = 1.0;
                } else {
                    self.gain_ramp = 0.0;
                }
                self.publish_atomics();
            }
            CallbackCommand::UpdateLoopBuffer { buffer } => {
                let loop_frames = buffer.channels.first().map_or(0, Vec::len);
                let old_sr = self
                    .loop_buf
                    .as_ref()
                    .map_or(buffer.sample_rate, |b| b.sample_rate);
                let cur_offset_sec = self.src_pos / old_sr.max(1) as f64;

                if loop_frames > 0 && self.mode == PlaybackMode::Loop {
                    self.src_pos = (cur_offset_sec * buffer.sample_rate as f64)
                        .rem_euclid(loop_frames as f64);
                    if self.playing && !self.pausing {
                        self.trigger_continuity_fade();
                    }
                }
                self.loop_buf = Some(buffer);
                self.publish_atomics();
            }
            CallbackCommand::AuditionSeam {
                buffer,
                lead_seconds,
            } => {
                let was_playing = self.playing && !self.pausing;
                let loop_frames = buffer.channels.first().map_or(0, Vec::len);
                if loop_frames == 0 {
                    return;
                }
                let offset = compute_audition_offset(&buffer, lead_seconds);
                self.src_pos =
                    (offset * buffer.sample_rate as f64).rem_euclid(loop_frames as f64);
                self.loop_buf = Some(buffer);
                self.mode = PlaybackMode::Loop;
                self.playing = true;
                self.pausing = false;
                if was_playing {
                    self.trigger_continuity_fade();
                    self.gain_ramp = 1.0;
                } else {
                    self.gain_ramp = 0.0;
                }
                self.publish_atomics();
            }
            CallbackCommand::PlayTrim {
                audio,
                start_sec,
                end_sec,
                from_sec,
            } => {
                let total = audio.frame_count();
                if total == 0 || audio.sample_rate == 0 {
                    return;
                }
                let sr = audio.sample_rate as f64;
                let s_idx = ((start_sec.clamp(0.0, audio.duration) * sr).round() as usize)
                    .min(total.saturating_sub(1));
                let e_idx =
                    ((end_sec.clamp(0.0, audio.duration) * sr).round() as usize).clamp(s_idx + 1, total);
                let start_pos = match from_sec {
                    Some(f) if f >= start_sec && f < end_sec => (f * sr).clamp(s_idx as f64, (e_idx - 1) as f64),
                    _ => s_idx as f64,
                };

                let was_playing = self.playing && !self.pausing;
                self.trim_audio = Some(audio);
                self.trim_start_idx = s_idx;
                self.trim_end_idx = e_idx;
                self.trim_start_sec = s_idx as f64 / sr;
                self.trim_end_sec = e_idx as f64 / sr;
                self.src_pos = start_pos;
                self.mode = PlaybackMode::Trim;
                self.playing = true;
                self.pausing = false;
                if was_playing {
                    self.trigger_continuity_fade();
                    self.gain_ramp = 1.0;
                } else {
                    self.gain_ramp = 0.0;
                }
                self.publish_atomics();
            }
            CallbackCommand::Pause => {
                if self.playing && !self.pausing {
                    self.pausing = true;
                }
                self.atomics.playing.store(false, Ordering::Relaxed);
            }
            CallbackCommand::Seek { position_sec } => {
                match self.mode {
                    PlaybackMode::Loop => {
                        if let Some(ref buf) = self.loop_buf {
                            let frames = buf.channels.first().map_or(0, Vec::len);
                            if frames > 0 {
                                let offset = source_sec_to_loop_offset(buf, position_sec);
                                self.src_pos =
                                    (offset * buf.sample_rate as f64).rem_euclid(frames as f64);
                                if self.playing && !self.pausing {
                                    self.trigger_continuity_fade();
                                }
                            }
                        }
                    }
                    PlaybackMode::Trim => {
                        if let Some(ref audio) = self.trim_audio {
                            let sr = audio.sample_rate as f64;
                            let target = (position_sec * sr)
                                .clamp(self.trim_start_idx as f64, self.trim_end_idx.saturating_sub(1) as f64);
                            self.src_pos = target;
                            if self.playing && !self.pausing {
                                self.trigger_continuity_fade();
                            }
                        }
                    }
                    PlaybackMode::Idle => {}
                }
                self.publish_atomics();
            }
            CallbackCommand::Reset => {
                self.playing = false;
                self.pausing = false;
                self.mode = PlaybackMode::Idle;
                self.loop_buf = None;
                self.trim_audio = None;
                self.src_pos = 0.0;
                self.gain_ramp = 0.0;
                self.xfade_remaining = 0;
                self.prev_out.fill(0.0);
                self.publish_atomics();
            }
        }
    }

    fn render<T>(&mut self, output: &mut [T])
    where
        T: SizedSample + FromSample<f32>,
    {
        if !self.playing {
            for sample in output.iter_mut() {
                *sample = T::from_sample(0.0f32);
            }
            self.prev_out.fill(0.0);
            return;
        }

        let out_ch = self.out_channels;
        for frame in output.chunks_exact_mut(out_ch) {
            if !self.playing {
                for s in frame.iter_mut() {
                    *s = T::from_sample(0.0f32);
                }
                self.prev_out.fill(0.0);
                continue;
            }

            if self.pausing {
                self.gain_ramp = (self.gain_ramp - self.gain_step).max(0.0);
                if self.gain_ramp <= 0.0 {
                    self.playing = false;
                    self.pausing = false;
                    for s in frame.iter_mut() {
                        *s = T::from_sample(0.0f32);
                    }
                    self.prev_out.fill(0.0);
                    continue;
                }
            } else if self.gain_ramp < 1.0 {
                self.gain_ramp = (self.gain_ramp + self.gain_step).min(1.0);
            }

            let target_vol = perceptual_gain(self.atomics.volume());
            let delta = target_vol - self.smoothed_volume;
            if delta.abs() <= self.gain_step {
                self.smoothed_volume = target_vol;
            } else {
                self.smoothed_volume += delta.signum() * self.gain_step;
            }
            let gain = self.gain_ramp * self.smoothed_volume;
            let xfade_alpha = if self.xfade_remaining > 0 {
                let a = self.xfade_remaining as f32 / self.fade_len as f32;
                self.xfade_remaining -= 1;
                a
            } else {
                0.0
            };

            match self.mode {
                PlaybackMode::Loop => {
                    if let Some(ref buf) = self.loop_buf {
                        let frames = buf.channels.first().map_or(0, Vec::len);
                        let src_ch = buf.channels.len();
                        if frames == 0 || src_ch == 0 {
                            self.playing = false;
                            for s in frame.iter_mut() {
                                *s = T::from_sample(0.0f32);
                            }
                            continue;
                        }

                        let idx0 = (self.src_pos.floor() as usize) % frames;
                        let idx1 = (idx0 + 1) % frames;
                        let frac = (self.src_pos - self.src_pos.floor()) as f32;

                        for c in 0..out_ch {
                            let ch = &buf.channels[c % src_ch];
                            let raw = ch[idx0] * (1.0 - frac) + ch[idx1] * frac;
                            let mut sample = raw * gain;
                            if xfade_alpha > 0.0 {
                                sample = self.xfade_hold[c] * xfade_alpha
                                    + sample * (1.0 - xfade_alpha);
                            }
                            let clamped = sample.clamp(-1.0, 1.0);
                            self.prev_out[c] = clamped;
                            frame[c] = T::from_sample(clamped);
                        }

                        let ratio = buf.sample_rate as f64 / self.device_sr;
                        self.src_pos += ratio;
                        while self.src_pos >= frames as f64 {
                            self.src_pos -= frames as f64;
                        }
                    } else {
                        self.playing = false;
                        for s in frame.iter_mut() {
                            *s = T::from_sample(0.0f32);
                        }
                    }
                }
                PlaybackMode::Trim => {
                    if let Some(ref audio) = self.trim_audio {
                        let src_ch = audio.channels.len();
                        if src_ch == 0 || self.trim_end_idx <= self.trim_start_idx {
                            self.playing = false;
                            for s in frame.iter_mut() {
                                *s = T::from_sample(0.0f32);
                            }
                            continue;
                        }

                        let idx0 = (self.src_pos.floor() as usize)
                            .clamp(self.trim_start_idx, self.trim_end_idx - 1);
                        let idx1 = (idx0 + 1).min(self.trim_end_idx - 1);
                        let frac = (self.src_pos - self.src_pos.floor()) as f32;

                        for c in 0..out_ch {
                            let ch = &audio.channels[c % src_ch];
                            let raw = ch[idx0] * (1.0 - frac) + ch[idx1] * frac;
                            let mut sample = raw * gain;
                            if xfade_alpha > 0.0 {
                                sample = self.xfade_hold[c] * xfade_alpha
                                    + sample * (1.0 - xfade_alpha);
                            }
                            let clamped = sample.clamp(-1.0, 1.0);
                            self.prev_out[c] = clamped;
                            frame[c] = T::from_sample(clamped);
                        }

                        let ratio = audio.sample_rate as f64 / self.device_sr;
                        self.src_pos += ratio;
                        if self.src_pos >= self.trim_end_idx as f64 {
                            self.src_pos = self.trim_end_idx as f64;
                            self.pausing = true;
                        }
                    } else {
                        self.playing = false;
                        for s in frame.iter_mut() {
                            *s = T::from_sample(0.0f32);
                        }
                    }
                }
                PlaybackMode::Idle => {
                    self.playing = false;
                    for s in frame.iter_mut() {
                        *s = T::from_sample(0.0f32);
                    }
                }
            }
        }

        self.publish_atomics();
    }

    fn publish_atomics(&self) {
        let is_playing = self.playing && !self.pausing;
        match self.mode {
            PlaybackMode::Loop => {
                if let Some(ref buf) = self.loop_buf {
                    let offset = (self.src_pos / buf.sample_rate.max(1) as f64)
                        .clamp(0.0, buf.duration);
                    let pos = loop_offset_to_source_sec(buf, offset);
                    self.atomics.store_all(
                        is_playing,
                        PlaybackMode::Loop,
                        pos,
                        offset,
                        buf.duration,
                    );
                } else {
                    self.atomics
                        .store_all(false, PlaybackMode::Idle, 0.0, 0.0, 0.0);
                }
            }
            PlaybackMode::Trim => {
                if let Some(ref audio) = self.trim_audio {
                    let sr = audio.sample_rate.max(1) as f64;
                    let pos = (self.src_pos / sr).clamp(self.trim_start_sec, self.trim_end_sec);
                    let offset = (pos - self.trim_start_sec).max(0.0);
                    let dur = (self.trim_end_sec - self.trim_start_sec).max(0.0);
                    self.atomics
                        .store_all(is_playing, PlaybackMode::Trim, pos, offset, dur);
                } else {
                    self.atomics
                        .store_all(false, PlaybackMode::Idle, 0.0, 0.0, 0.0);
                }
            }
            PlaybackMode::Idle => {
                self.atomics
                    .store_all(false, PlaybackMode::Idle, 0.0, 0.0, 0.0);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loop_position_mapping_roundtrips_cleanly() {
        let sr = 48_000u32;
        let fade_samples = 1920; // 40ms
        let loop_buf = RenderedLoop {
            channels: vec![vec![0.0; sr as usize * 8]],
            sample_rate: sr,
            duration: 8.0,
            source_start_sec: 2.0,
            source_end_sec: 10.04,
            fade_samples,
        };

        // Start of body (offset = 0) maps to source_start + fade = 2.04
        let pos0 = loop_offset_to_source_sec(&loop_buf, 0.0);
        assert!((pos0 - 2.04).abs() < 1e-6);
        assert!(source_sec_to_loop_offset(&loop_buf, pos0).abs() < 1e-6);

        // Middle of body
        let pos_mid = loop_offset_to_source_sec(&loop_buf, 4.0);
        assert!((pos_mid - 6.04).abs() < 1e-6);
        assert!((source_sec_to_loop_offset(&loop_buf, pos_mid) - 4.0).abs() < 1e-6);

        // Inside crossfade head (2.02s -> 20ms into crossfade => body_dur 7.96 + 0.02 = 7.98)
        let offset_head = source_sec_to_loop_offset(&loop_buf, 2.02);
        assert!((offset_head - 7.98).abs() < 1e-6);
    }

    #[test]
    fn volume_clamps_and_scales_perceptually() {
        let atomics = PlaybackAtomics::new();
        assert!((atomics.set_volume(1.5) - 1.0).abs() < 1e-6);
        assert!((atomics.set_volume(-0.2) - 0.0).abs() < 1e-6);
        assert!((atomics.set_volume(f32::NAN) - 0.85).abs() < 1e-6);
        assert!((perceptual_gain(0.0) - 0.0).abs() < 1e-6);
        assert!((perceptual_gain(1.0) - 1.0).abs() < 1e-6);
        assert!(perceptual_gain(0.5) < 0.5 && perceptual_gain(0.5) > 0.2);
    }
}
