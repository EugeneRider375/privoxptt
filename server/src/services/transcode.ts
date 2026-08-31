import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Перекодирует голосовое сообщение (D34) в единый нефрагментированный
 * AAC/M4A. Нужно потому что разные Android-телефоны по-разному выбирают
 * формат MediaRecorder — включая фрагментированный mp4, который WebKit до
 * iOS/Safari 18.4 не проигрывает из blob-URL (подтверждено живым тестом
 * 2026-08-31: один Android телефон играл на iPhone, другой — нет, при
 * одинаковом клиентском коде). moov-атом в начале файла (+faststart)
 * гарантирует воспроизведение везде, независимо от исходного формата.
 */
export async function transcodeVoiceNote(inputPath: string, outputPath: string): Promise<void> {
  await execFileAsync('ffmpeg', [
    '-y',
    '-i', inputPath,
    '-vn',
    '-ac', '1',
    '-ar', '44100',
    '-c:a', 'aac',
    '-b:a', '96k',
    '-movflags', '+faststart',
    '-f', 'mp4',
    outputPath,
  ], { timeout: 30_000 });
}
