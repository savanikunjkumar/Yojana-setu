'use client';

import { synthesizeSpeech } from './api';

/**
 * Speaks text, preferring server-generated audio and falling back to the browser.
 *
 * Both paths matter. Sarvam's Bulbul produces far better Indian-language audio, but
 * `SpeechSynthesis` needs no key, no network and no account — so the spoken loop keeps
 * working on a laptop with nothing configured, which is the point of the fallback.
 *
 * Resolves when speech finishes, so a caller can await it before listening again and
 * avoid recording its own voice.
 */
export async function speak(text: string, language: string): Promise<void> {
  try {
    const result = await synthesizeSpeech({ text, language });

    if (result.audioBase64 && result.mimeType) {
      await playBase64Audio(result.audioBase64, result.mimeType);
      return;
    }
  } catch {
    // Server-side speech is optional; fall through to the browser.
  }

  await speakInBrowser(text, language);
}

function playBase64Audio(audioBase64: string, mimeType: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const audio = new Audio(`data:${mimeType};base64,${audioBase64}`);
    audio.onended = () => resolve();
    audio.onerror = () => reject(new Error('Could not play the audio'));
    void audio.play().catch(reject);
  });
}

/**
 * Picks the closest available voice for the language. Browsers ship wildly different
 * voice sets, and an exact `hi-IN` match often does not exist, so a same-language
 * voice is better than letting an English voice mangle Devanagari.
 */
function speakInBrowser(text: string, language: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      resolve();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language;
    utterance.rate = 0.95;

    const voices = window.speechSynthesis.getVoices();
    const base = language.split('-')[0] ?? 'hi';
    const voice =
      voices.find((candidate) => candidate.lang === language) ??
      voices.find((candidate) => candidate.lang.startsWith(base));
    if (voice) utterance.voice = voice;

    utterance.onend = () => resolve();
    // Never leave the caller hanging on a voice that fails to start.
    utterance.onerror = () => resolve();

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  });
}

export function stopSpeaking(): void {
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}
