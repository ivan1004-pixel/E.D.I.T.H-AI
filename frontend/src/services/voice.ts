/**
 * Servicio de Voz Neuronal Hiperrealista (Neural TTS) para el modo Voz a Voz de Edith.
 * Utiliza voces neuronales de 24kHz desde el backend (`/api/chat/tts`) para sonar 100% humana y natural.
 */

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export interface NeuralVoiceOption {
  id: string;
  label: string;
}

export const NEURAL_VOICES: NeuralVoiceOption[] = [
  { id: 'es-MX-DaliaNeural', label: 'Dalia (México · Natural)' },
  { id: 'es-CO-SalomeNeural', label: 'Salomé (Colombia · Cálida)' },
  { id: 'es-ES-ElviraNeural', label: 'Elvira (España · Clara)' },
  { id: 'es-AR-ElenaNeural', label: 'Elena (Argentina · Suave)' },
  { id: 'es-MX-JorgeNeural', label: 'Jorge (México · Jarvis)' },
];

let currentAudio: HTMLAudioElement | null = null;
let currentAbortController: AbortController | null = null;
let selectedNeuralVoice = 'es-MX-DaliaNeural';

export function getSelectedNeuralVoice(): string {
  return selectedNeuralVoice;
}

export function setSelectedNeuralVoice(voiceId: string): void {
  selectedNeuralVoice = voiceId;
}

export function cleanTextForSpeech(raw: string): string {
  return raw
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F]/gu, '')
    .replace(/```[\s\S]*?```/g, ' bloque de código ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[-•]\s+/g, '. ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stopEdithSpeech(): void {
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

export function isEdithSpeaking(): boolean {
  if (currentAudio && !currentAudio.paused) return true;
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    return window.speechSynthesis.speaking;
  }
  return false;
}

export async function speakWithEdith(
  text: string,
  callbacks?: {
    onStart?: () => void;
    onEnd?: () => void;
  },
  voiceOverride?: string
): Promise<void> {
  stopEdithSpeech();

  const clean = cleanTextForSpeech(text);
  if (!clean) {
    callbacks?.onEnd?.();
    return;
  }

  const controller = new AbortController();
  currentAbortController = controller;

  try {
    callbacks?.onStart?.();
    const res = await fetch(`${API_BASE}/api/chat/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: clean,
        voice: voiceOverride || selectedNeuralVoice,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error('Error en servidor TTS');
    }

    const data = await res.json();
    if (!data?.audioBase64 || controller.signal.aborted) {
      callbacks?.onEnd?.();
      return;
    }

    const audio = new Audio(`data:${data.mimeType || 'audio/mpeg'};base64,${data.audioBase64}`);
    currentAudio = audio;

    audio.onended = () => {
      currentAudio = null;
      callbacks?.onEnd?.();
    };

    audio.onerror = () => {
      currentAudio = null;
      callbacks?.onEnd?.();
    };

    await audio.play();
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      callbacks?.onEnd?.();
      return;
    }
    // Respaldo local si el navegador bloquea autoplay
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.lang = 'es-MX';
      utterance.onend = () => callbacks?.onEnd?.();
      utterance.onerror = () => callbacks?.onEnd?.();
      window.speechSynthesis.speak(utterance);
    } else {
      callbacks?.onEnd?.();
    }
  }
}
