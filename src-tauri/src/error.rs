use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Аудиофайл не загружен")]
    NoAudioLoaded,
    #[error("Нет файла в режиме обрезки")]
    NoPendingAudio,
    #[error("Петля ещё не рассчитана")]
    NoLoopRendered,
    #[error("Не удалось открыть файл: {0}")]
    Io(#[from] std::io::Error),
    #[error("Не удалось декодировать аудио: {0}")]
    Decode(String),
    #[error("Не удалось записать WAV: {0}")]
    Encode(String),
    #[error("Некорректный диапазон: {0}")]
    InvalidRange(String),
    #[error("Анализ отменён")]
    Cancelled,
    #[error("Ошибка аудиоустройства: {0}")]
    AudioDevice(String),
    #[error("Внутренняя ошибка: {0}")]
    Internal(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
