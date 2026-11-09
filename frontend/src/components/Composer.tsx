import React, { useState, useRef, KeyboardEvent, useId, useEffect } from 'react';
import {
  ArrowUp,
  Zap,
  Sparkles,
  Rocket,
  Check,
  ChevronDown,
  Mic,
  Square,
  AlertCircle,
} from 'lucide-react';
import { transcribeVoiceApi } from '../services/api';

interface ComposerProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

interface ModeOption {
  id: string;
  name: string;
  badge?: string;
  desc: string;
  icon: React.ReactNode;
}

const MODES: ModeOption[] = [
  {
    id: 'speed',
    name: 'Speed',
    badge: '(Recommended)',
    desc: 'Gemini Flash · Respuesta rápida + Gmail & Calendar',
    icon: <Zap size={15} />,
  },
  {
    id: 'facts',
    name: 'Fast Facts',
    badge: '(Tools)',
    desc: 'Respuestas directas verificadas con tus datos en SQLite',
    icon: <Sparkles size={15} />,
  },
  {
    id: 'instant',
    name: 'Instant',
    badge: '(Low Latency)',
    desc: 'Menor latencia TTFT para comandos rápidos de agenda',
    icon: <Rocket size={15} />,
  },
];

/**
 * Convierte un AudioBuffer decodificado en un archivo WAV PCM 16-bit 16kHz Mono en Base64.
 * Gemini acepta `audio/wav` con 200 OK en todos los modelos gratuitos.
 */
function audioBufferToWavBase64(audioBuffer: AudioBuffer): string {
  const targetSampleRate = 16000;
  const rawData = audioBuffer.getChannelData(0);
  const ratio = audioBuffer.sampleRate / targetSampleRate;
  const newLength = Math.max(1, Math.round(rawData.length / ratio));
  const pcm16 = new Int16Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const srcIdx = Math.min(rawData.length - 1, Math.floor(i * ratio));
    const sample = Math.max(-1, Math.min(1, rawData[srcIdx]));
    pcm16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  const byteLength = 44 + pcm16.length * 2;
  const buffer = new ArrayBuffer(byteLength);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + pcm16.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, targetSampleRate, true);
  view.setUint32(28, targetSampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, pcm16.length * 2, true);

  let offset = 44;
  for (let i = 0; i < pcm16.length; i++, offset += 2) {
    view.setInt16(offset, pcm16[i], true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export const Composer: React.FC<ComposerProps> = ({ onSend, disabled }) => {
  const [text, setText] = useState('');
  const [selectedMode, setSelectedMode] = useState<ModeOption>(MODES[0]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [voiceHint, setVoiceHint] = useState<{
    type: 'recording' | 'transcribing' | 'error';
    text: string;
  } | null>(null);

  const formRef = useRef<HTMLFormElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const vadTimerRef = useRef<number | null>(null);
  const vadAudioCtxRef = useRef<AudioContext | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const lastCompositionEndAt = useRef<number | null>(null);
  const inputId = useId();

  useEffect(() => {
    return () => {
      stopMediaStream();
    };
  }, []);

  const stopMediaStream = () => {
    if (vadTimerRef.current !== null) {
      window.clearInterval(vadTimerRef.current);
      vadTimerRef.current = null;
    }
    if (vadAudioCtxRef.current) {
      vadAudioCtxRef.current.close().catch(() => {});
      vadAudioCtxRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || disabled || isTranscribing) return;
    onSend(trimmed);
    setText('');
  };

  const toggleVoiceDictation = async () => {
    if (disabled || isTranscribing) return;

    if (isRecording && mediaRecorderRef.current) {
      if (mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      setIsRecording(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          audioChunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = async () => {
        setIsRecording(false);
        stopMediaStream();
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        if (blob.size < 400) {
          setVoiceHint({ type: 'error', text: 'No se detectó voz suficiente.' });
          setTimeout(() => setVoiceHint(null), 2500);
          return;
        }

        setIsTranscribing(true);
        setVoiceHint({
          type: 'transcribing',
          text: 'Transcribiendo tu voz y enviando mensaje automáticamente...',
        });

        try {
          const arrayBuffer = await blob.arrayBuffer();
          const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
          const wavBase64 = audioBufferToWavBase64(decodedBuffer);
          await audioCtx.close();

          const spokenText = (await transcribeVoiceApi(wavBase64, 'audio/wav')).trim();
          setIsTranscribing(false);
          setVoiceHint(null);

          const cleanSpoken = spokenText
            .replace(/^\[silencio\]$/i, '')
            .replace(/^<noise>$/i, '')
            .trim();

          if (cleanSpoken) {
            setText('');
            onSend(cleanSpoken);
          } else {
            setVoiceHint({
              type: 'error',
              text: 'No se escucharon palabras claras. Intenta hablar un poco más fuerte.',
            });
            setTimeout(() => setVoiceHint(null), 3500);
          }
        } catch (err: any) {
          setIsTranscribing(false);
          setVoiceHint({
            type: 'error',
            text: err?.message || 'Error al transcribir el audio.',
          });
          setTimeout(() => setVoiceHint(null), 4000);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setVoiceHint({
        type: 'recording',
        text: 'Escuchando... Al terminar de hablar se enviará automáticamente',
      });

      // Detector automático de silencio (Voice Activity Detection) para enviar al terminar de hablar
      try {
        const vadCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        vadAudioCtxRef.current = vadCtx;
        const source = vadCtx.createMediaStreamSource(stream);
        const analyser = vadCtx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);

        const dataArray = new Float32Array(analyser.fftSize);
        let hasSpoken = false;
        let lastSpeechTime = Date.now();
        const startedAt = Date.now();

        vadTimerRef.current = window.setInterval(() => {
          if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== 'recording') {
            return;
          }
          analyser.getFloatTimeDomainData(dataArray);
          let sumSquares = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sumSquares += dataArray[i] * dataArray[i];
          }
          const rms = Math.sqrt(sumSquares / dataArray.length);
          const now = Date.now();

          if (rms > 0.016) {
            hasSpoken = true;
            lastSpeechTime = now;
          } else if (hasSpoken && now - lastSpeechTime > 1500) {
            // 1.5 segundos de silencio tras haber hablado -> detener y enviar automáticamente
            if (mediaRecorderRef.current.state === 'recording') {
              mediaRecorderRef.current.stop();
            }
          } else if (!hasSpoken && now - startedAt > 9000) {
            // Si pasaron 9 segundos sin hablar, cerrar micrófono
            if (mediaRecorderRef.current.state === 'recording') {
              mediaRecorderRef.current.stop();
            }
          }
        }, 100);
      } catch {
        // Si el navegador bloquea el AnalyserNode secundario, el botón manual sigue funcionando
      }
    } catch (err: any) {
      setIsRecording(false);
      setVoiceHint({
        type: 'error',
        text: 'Permite el acceso al micrófono en Opera GX para poder dictar.',
      });
      setTimeout(() => setVoiceHint(null), 4000);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();

      const nativeEvent = event.nativeEvent as globalThis.KeyboardEvent;
      if (nativeEvent.isComposing || nativeEvent.keyCode === 229) {
        return;
      }
      if (
        lastCompositionEndAt.current !== null &&
        Math.abs(nativeEvent.timeStamp - lastCompositionEndAt.current) < 50
      ) {
        return;
      }

      formRef.current?.requestSubmit();
    }
  };

  return (
    <div className="composer-container">
      <div className="composer-inner">
        {voiceHint && (
          <div
            className="voice-status-pill"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '7px' }}
          >
            {voiceHint.type === 'recording' && <Mic size={14} />}
            {voiceHint.type === 'transcribing' && <Sparkles size={14} />}
            {voiceHint.type === 'error' && <AlertCircle size={14} />}
            <span>{voiceHint.text}</span>
          </div>
        )}

        {menuOpen && (
          <div className="parallel-model-popover" role="listbox" aria-label="Select Chat Model">
            <div className="popover-header">Select Chat Model</div>
            {MODES.map((m) => {
              const active = m.id === selectedMode.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  className={`popover-option ${active ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedMode(m);
                    setMenuOpen(false);
                  }}
                >
                  <div className="popover-opt-icon">{m.icon}</div>
                  <div className="popover-opt-text">
                    <div className="popover-opt-title">
                      <strong>{m.name}</strong>{' '}
                      {m.badge && <span className="popover-opt-badge">{m.badge}</span>}
                    </div>
                    <div className="popover-opt-desc">{m.desc}</div>
                  </div>
                  {active && <Check size={15} className="popover-check" />}
                </button>
              );
            })}
          </div>
        )}

        <form ref={formRef} className="parallel-composer-card" onSubmit={handleFormSubmit}>
          <label htmlFor={inputId} className="visually-hidden">
            Mensaje para Edith
          </label>
          <textarea
            id={inputId}
            className="composer-input"
            rows={1}
            placeholder="Escribe o haz clic en Dictar para hablar con Edith..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onCompositionEnd={(e) => {
              lastCompositionEndAt.current = e.nativeEvent.timeStamp;
            }}
            onKeyDown={handleKeyDown}
            disabled={disabled || isTranscribing}
          />

          <div className="composer-bottom-bar">
            <button
              type="button"
              className="model-selector-pill"
              onClick={() => setMenuOpen((prev) => !prev)}
            >
              {selectedMode.icon}
              <span>{selectedMode.name}</span>
              <ChevronDown size={13} />
            </button>

            <div className="composer-right-actions">
              <button
                type="button"
                className={`mic-dictate-btn ${isRecording ? 'listening' : ''}`}
                onClick={toggleVoiceDictation}
                disabled={disabled || isTranscribing}
                title={
                  isRecording
                    ? 'Haz clic para terminar de grabar, transcribir y enviar'
                    : 'Dictar por voz con Gemini'
                }
              >
                {isRecording ? <Square size={13} /> : <Mic size={15} />}
                <span>
                  {isTranscribing
                    ? 'Transcribiendo...'
                    : isRecording
                    ? 'Enviar voz'
                    : 'Dictar'}
                </span>
              </button>

              <button
                type="submit"
                className="parallel-send-circle"
                disabled={disabled || isTranscribing || !text.trim()}
                title="Enviar mensaje"
              >
                <ArrowUp size={16} />
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
