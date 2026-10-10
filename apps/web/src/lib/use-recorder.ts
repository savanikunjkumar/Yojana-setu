'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type RecorderState = 'unsupported' | 'idle' | 'requesting' | 'recording' | 'error';

export interface Recording {
  audioBase64: string;
  mimeType: string;
  durationMs: number;
}

/**
 * Microphone capture over MediaRecorder.
 *
 * Returns base64 rather than a Blob because the API takes audio as JSON, and because
 * a serialisable value is far easier to hand around React state than a Blob whose
 * lifetime is tied to an object URL.
 *
 * The stream is stopped after every recording rather than held open, so the browser's
 * recording indicator goes away when the user is not speaking. On a shared or public
 * device, a mic that stays live is a thing people rightly notice.
 */
export function useRecorder(): {
  state: RecorderState;
  error: string | null;
  elapsedMs: number;
  start: () => Promise<void>;
  stop: () => Promise<Recording | null>;
  cancel: () => void;
} {
  const [state, setState] = useState<RecorderState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const supported =
      typeof window !== 'undefined' &&
      typeof window.MediaRecorder !== 'undefined' &&
      Boolean(navigator.mediaDevices?.getUserMedia);

    setState(supported ? 'idle' : 'unsupported');
  }, []);

  const releaseStream = useCallback(() => {
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  useEffect(() => releaseStream, [releaseStream]);

  const start = useCallback(async () => {
    setError(null);
    setState('requesting');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // Phone microphones in noisy places; let the browser help.
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.start();
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      setElapsedMs(0);
      setState('recording');

      tickRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startedAtRef.current);
      }, 200);
    } catch (caught) {
      releaseStream();
      const name = (caught as DOMException)?.name;
      setError(
        name === 'NotAllowedError'
          ? 'Microphone permission was blocked. Allow it in your browser, or type your answers instead.'
          : name === 'NotFoundError'
            ? 'No microphone was found. You can type your answers instead.'
            : `Could not start recording: ${(caught as Error).message}`,
      );
      setState('error');
    }
  }, [releaseStream]);

  const stop = useCallback(async (): Promise<Recording | null> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      setState('idle');
      return null;
    }

    const durationMs = Date.now() - startedAtRef.current;

    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        resolve(new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' }));
      };
      recorder.stop();
    });

    releaseStream();
    recorderRef.current = null;
    setState('idle');
    setElapsedMs(0);

    if (blob.size === 0) return null;

    return {
      audioBase64: await blobToBase64(blob),
      mimeType: blob.type || 'audio/webm',
      durationMs,
    };
  }, [releaseStream]);

  const cancel = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = null;
      recorder.stop();
    }
    releaseStream();
    recorderRef.current = null;
    chunksRef.current = [];
    setElapsedMs(0);
    setState('idle');
  }, [releaseStream]);

  return { state, error, elapsedMs, start, stop, cancel };
}

/**
 * Opus in WebM is the best-supported combination in Chrome and Firefox; Safari only
 * produces MP4/AAC. Returning undefined lets the browser pick its own default rather
 * than throwing on an unsupported type.
 */
function pickMimeType(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];

  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the recording'));
    reader.onloadend = () => {
      const result = String(reader.result);
      // Strip the `data:audio/webm;base64,` prefix the API does not want.
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
}
