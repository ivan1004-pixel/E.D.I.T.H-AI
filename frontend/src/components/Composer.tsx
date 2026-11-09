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
  Volume2,
  VolumeX,
  Radio,
  AudioLines,
} from 'lucide-react';
import { transcribeVoiceApi } from '../services/api';
import {
  getSelectedNeuralVoice,
  NEURAL_VOICES,
  setSelectedNeuralVoice,
  speakWithEdith,
} from '../services/voice';

interface ComposerProps {
  onSend: (message: string, fromVoice?: boolean) => void;
  disabled?: boolean;
  isEdithSpeaking?: boolean;
  onStopSpeaking?: () => void;
  voiceReplyEnabled?: boolean;
  onToggleVoiceReply?: () => void;
  handsFreeEnabled?: boolean;
  onToggleHandsFree?: () => void;
  wakeWord?: string;
  onChangeWakeWord?: (word: string) => void;
  isFollowUpWindowActive?: boolean;
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

/**
 * Verifica si el texto transcrito contiene la palabra clave ("edith" o la que elija Ivan).
 */
function matchesWakeWord(spokenText: string, wakeWord: string): { matched: boolean; onlyWakeWord: boolean } {
  const cleanWake = wakeWord.trim().toLowerCase();
  if (!cleanWake) {
    return { matched: true, onlyWakeWord: false };
  }

  const normalized = spokenText
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.,¡!¿?]/g, '')
    .trim();

  const wakeVariants =
    cleanWake === 'edith'
      ? ['edith', 'edit', 'edid', 'hedith', 'edis', 'edyt', 'edy']
      : [cleanWake];

  const matched = wakeVariants.some((variant) => normalized.includes(variant));
  if (!matched) {
    return { matched: false, onlyWakeWord: false };
  }

  let remainder = normalized;
  for (const variant of wakeVariants) {
    remainder = remainder.replace(new RegExp(`\\b(hola|oye|hey|ok)?\\s*${variant}\\b`, 'gi'), '').trim();
  }

  return { matched: true, onlyWakeWord: remainder.length < 3 };
}

export const Composer: React.FC<ComposerProps> = ({
  onSend,
  disabled = false,
  isEdithSpeaking = false,
  onStopSpeaking,
  voiceReplyEnabled = true,
  onToggleVoiceReply,
  handsFreeEnabled = false,
  onToggleHandsFree,
  wakeWord = 'edith',
  onChangeWakeWord,
  isFollowUpWindowActive = false,
}) => {
  const [text, setText] = useState('');
  const [selectedMode, setSelectedMode] = useState<ModeOption>(MODES[0]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [neuralVoice, setNeuralVoice] = useState<string>(getSelectedNeuralVoice());
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
  const localWakeTriggeredUntilRef = useRef<number>(0);
  const lastCompositionEndAt = useRef<number | null>(null);
  const inputId = useId();

  // Refs actualizados para que el bucle continuo manos libres lea el estado más reciente
  const stateRef = useRef({
    disabled,
    isEdithSpeaking,
    isTranscribing,
    handsFreeEnabled,
    wakeWord,
    isFollowUpWindowActive,
    onSend,
  });

  useEffect(() => {
    stateRef.current = {
      disabled,
      isEdithSpeaking,
      isTranscribing,
      handsFreeEnabled,
      wakeWord,
      isFollowUpWindowActive,
      onSend,
    };
  }, [
    disabled,
    isEdithSpeaking,
    isTranscribing,
    handsFreeEnabled,
    wakeWord,
    isFollowUpWindowActive,
    onSend,
  ]);

  useEffect(() => {
    return () => {
      stopMediaStream();
    };
  }, []);

  // Activar o detener el bucle de escucha continua manos libres ("Edith" / cualquier palabra)
  useEffect(() => {
    if (handsFreeEnabled) {
      startHandsFreeMonitor();
    } else {
      stopMediaStream();
      setIsRecording(false);
      setVoiceHint(null);
    }
    return () => {
      if (!handsFreeEnabled) {
        stopMediaStream();
      }
    };
  }, [handsFreeEnabled]);

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

  /**
   * Monitor continuo de voz manos libres (0 consumo de API en silencio).
   * Cuando detecta que Ivan habla y hace una pausa, transcribe el fragmento y verifica la palabra clave.
   */
  const startHandsFreeMonitor = async () => {
    stopMediaStream();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const vadCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      vadAudioCtxRef.current = vadCtx;
      const source = vadCtx.createMediaStreamSource(stream);
      const analyser = vadCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);

      const dataArray = new Float32Array(analyser.fftSize);
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      let activeClipRecorder: MediaRecorder | null = null;
      let clipChunks: Blob[] = [];
      let speechStartAt = 0;
      let lastVoiceAt = 0;
      let busyProcessingClip = false;

      setVoiceHint({
        type: 'recording',
        text: stateRef.current.wakeWord.trim()
          ? `Manos libres activo: di "${stateRef.current.wakeWord}" seguido de tu instrucción`
          : 'Manos libres activo: habla en cualquier momento y se enviará solo',
      });

      vadTimerRef.current = window.setInterval(() => {
        const st = stateRef.current;
        if (!st.handsFreeEnabled) return;

        // Si Edith está hablando o procesando, pausamos la captura para que no se escuche a sí misma
        if (st.disabled || st.isEdithSpeaking || st.isTranscribing || busyProcessingClip) {
          if (activeClipRecorder && activeClipRecorder.state === 'recording') {
            clipChunks = [];
            activeClipRecorder.stop();
            activeClipRecorder = null;
          }
          return;
        }

        analyser.getFloatTimeDomainData(dataArray);
        let sumSquares = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sumSquares += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sumSquares / dataArray.length);
        const now = Date.now();

        if (!activeClipRecorder || activeClipRecorder.state === 'inactive') {
          if (rms > 0.019) {
            clipChunks = [];
            speechStartAt = now;
            lastVoiceAt = now;
            const rec = new MediaRecorder(stream, { mimeType });
            rec.ondataavailable = (ev) => {
              if (ev.data && ev.data.size > 0) clipChunks.push(ev.data);
            };
            rec.onstop = async () => {
              setIsRecording(false);
              const durationMs = Date.now() - speechStartAt;
              const blob = new Blob(clipChunks, { type: mimeType });
              if (durationMs < 400 || blob.size < 600 || st.disabled || st.isEdithSpeaking) {
                return;
              }

              busyProcessingClip = true;
              setIsTranscribing(true);
              setVoiceHint({
                type: 'transcribing',
                text: 'Escuché tu voz, transcribiendo con Gemini...',
              });

              try {
                const arrayBuffer = await blob.arrayBuffer();
                const decodeCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
                const decodedBuffer = await decodeCtx.decodeAudioData(arrayBuffer);
                const wavBase64 = audioBufferToWavBase64(decodedBuffer);
                await decodeCtx.close();

                const spokenText = (await transcribeVoiceApi(wavBase64, 'audio/wav')).trim();
                const cleanSpoken = spokenText
                  .replace(/^\[silencio\]$/i, '')
                  .replace(/^<noise>$/i, '')
                  .trim();

                setIsTranscribing(false);
                busyProcessingClip = false;

                if (!cleanSpoken || cleanSpoken.length < 2) {
                  setVoiceHint({
                    type: 'recording',
                    text: stateRef.current.wakeWord.trim()
                      ? `Manos libres activo: di "${stateRef.current.wakeWord}" para hablar con Edith`
                      : 'Manos libres activo: te escucho...',
                  });
                  return;
                }

                const wakeCheck = matchesWakeWord(cleanSpoken, stateRef.current.wakeWord);
                const inFollowUp =
                  stateRef.current.isFollowUpWindowActive ||
                  localWakeTriggeredUntilRef.current > Date.now();

                if (wakeCheck.matched || inFollowUp) {
                  if (wakeCheck.onlyWakeWord && !inFollowUp) {
                    localWakeTriggeredUntilRef.current = Date.now() + 30000;
                    setVoiceHint({
                      type: 'recording',
                      text: 'Te escucho, Ivan. Di tu instrucción y se enviará automáticamente...',
                    });
                  } else {
                    localWakeTriggeredUntilRef.current = Date.now() + 30000;
                    setVoiceHint(null);
                    stateRef.current.onSend(cleanSpoken, true);
                  }
                } else {
                  setVoiceHint({
                    type: 'recording',
                    text: `Escuché "${cleanSpoken.slice(0, 28)}..." (di "${stateRef.current.wakeWord}" para activar o deja vacía la palabra clave)`,
                  });
                }
              } catch {
                setIsTranscribing(false);
                busyProcessingClip = false;
              }
            };

            activeClipRecorder = rec;
            rec.start();
            setIsRecording(true);
            setVoiceHint({
              type: 'recording',
              text: 'Capturando tu voz... Se enviará al terminar de hablar',
            });
          }
        } else if (activeClipRecorder.state === 'recording') {
          if (rms > 0.015) {
            lastVoiceAt = now;
          } else if (now - lastVoiceAt > 1350 || now - speechStartAt > 15000) {
            activeClipRecorder.stop();
          }
        }
      }, 100);
    } catch {
      setVoiceHint({
        type: 'error',
        text: 'Permite el acceso al micrófono en Opera GX para usar el modo manos libres.',
      });
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || disabled || isTranscribing) return;
    onSend(trimmed, false);
    setText('');
  };

  /**
   * Dictado directo de 1 toque (con envío automático al terminar de hablar).
   */
  const toggleVoiceDictation = async () => {
    if (disabled || isTranscribing) return;

    if (handsFreeEnabled && onToggleHandsFree) {
      onToggleHandsFree();
    }

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
            onSend(cleanSpoken, true);
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
          } else if (hasSpoken && now - lastSpeechTime > 1400) {
            if (mediaRecorderRef.current.state === 'recording') {
              mediaRecorderRef.current.stop();
            }
          } else if (!hasSpoken && now - startedAt > 9000) {
            if (mediaRecorderRef.current.state === 'recording') {
              mediaRecorderRef.current.stop();
            }
          }
        }, 100);
      } catch {
        // Fallback manual
      }
    } catch {
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
        {isEdithSpeaking && (
          <div
            className="voice-status-pill"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              background: '#171717',
              color: '#fff',
            }}
          >
            <AudioLines size={14} />
            <span>Edith te está respondiendo por voz...</span>
            {onStopSpeaking && (
              <button
                type="button"
                onClick={onStopSpeaking}
                style={{
                  marginLeft: '6px',
                  padding: '2px 8px',
                  borderRadius: '999px',
                  border: '1px solid rgba(255,255,255,0.3)',
                  background: 'transparent',
                  color: '#fff',
                  fontSize: '0.74rem',
                  cursor: 'pointer',
                }}
              >
                Callar voz
              </button>
            )}
          </div>
        )}

        {!isEdithSpeaking && voiceHint && (
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
            placeholder={
              handsFreeEnabled
                ? wakeWord.trim()
                  ? `Modo Voz a Voz activo: di "${wakeWord}" seguido de lo que necesites...`
                  : 'Modo Voz a Voz activo: habla libremente y Edith te contestará con voz...'
                : 'Escribe o usa Voz a Voz / Dictar para hablar con Edith...'
            }
            value={text}
            onChange={(e) => setText(e.target.value)}
            onCompositionEnd={(e) => {
              lastCompositionEndAt.current = e.nativeEvent.timeStamp;
            }}
            onKeyDown={handleKeyDown}
            disabled={disabled || isTranscribing}
          />

          <div className="composer-bottom-bar" style={{ flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="model-selector-pill"
                onClick={() => setMenuOpen((prev) => !prev)}
              >
                {selectedMode.icon}
                <span>{selectedMode.name}</span>
                <ChevronDown size={13} />
              </button>

              {onToggleVoiceReply && (
                <button
                  type="button"
                  className="model-selector-pill"
                  onClick={onToggleVoiceReply}
                  title="Activar o silenciar la voz hablada de Edith"
                  style={{
                    borderColor: voiceReplyEnabled ? 'var(--accent)' : undefined,
                    color: voiceReplyEnabled ? 'var(--accent)' : undefined,
                  }}
                >
                  {voiceReplyEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
                  <span>{voiceReplyEnabled ? 'Voz Edith: ON' : 'Voz Edith: OFF'}</span>
                </button>
              )}

              {voiceReplyEnabled && (
                <select
                  className="model-selector-pill"
                  value={neuralVoice}
                  onChange={(e) => {
                    const v = e.target.value;
                    setNeuralVoice(v);
                    setSelectedNeuralVoice(v);
                    speakWithEdith('Hola Ivan, esta es mi nueva voz neuronal.', undefined, v);
                  }}
                  title="Elige la voz neuronal natural de Edith"
                  style={{ cursor: 'pointer', outline: 'none' }}
                >
                  {NEURAL_VOICES.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              )}

              {onToggleHandsFree && (
                <button
                  type="button"
                  className={`mic-dictate-btn ${handsFreeEnabled ? 'listening' : ''}`}
                  onClick={onToggleHandsFree}
                  title="Activa la escucha continua Voz a Voz al decir la palabra clave"
                >
                  <Radio size={14} />
                  <span>{handsFreeEnabled ? 'Voz a Voz: ACTIVO' : 'Activar Voz a Voz'}</span>
                </button>
              )}

              {handsFreeEnabled && onChangeWakeWord && (
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    background: 'rgba(0,0,0,0.04)',
                    padding: '3px 8px',
                    borderRadius: '999px',
                    fontSize: '0.75rem',
                  }}
                  title="Palabra clave para activar (déjalo vacío si quieres que se active con cualquier palabra)"
                >
                  <span>Palabra:</span>
                  <input
                    type="text"
                    value={wakeWord}
                    onChange={(e) => onChangeWakeWord(e.target.value)}
                    placeholder="cualquiera"
                    style={{
                      width: '68px',
                      border: 'none',
                      background: 'transparent',
                      fontWeight: 600,
                      fontSize: '0.76rem',
                      outline: 'none',
                    }}
                  />
                </div>
              )}
            </div>

            <div className="composer-right-actions">
              <button
                type="button"
                className={`mic-dictate-btn ${isRecording && !handsFreeEnabled ? 'listening' : ''}`}
                onClick={toggleVoiceDictation}
                disabled={disabled || isTranscribing}
                title="Dictar un mensaje (se envía solo al terminar de hablar)"
              >
                {isRecording && !handsFreeEnabled ? <Square size={13} /> : <Mic size={15} />}
                <span>
                  {isTranscribing
                    ? 'Transcribiendo...'
                    : isRecording && !handsFreeEnabled
                    ? 'Escuchando...'
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
