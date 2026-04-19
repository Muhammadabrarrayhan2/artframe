"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppShell } from "@/components/AppShell";
import { api, ApiError, buildBackendUrl, type LabStylesOut, type VoicePresetsOut, type VideoPresetsOut } from "@/lib/api";
import { cn, formatBytes } from "@/lib/utils";
import { Wand2, UploadCloud, X, Loader2, Download, ShieldCheck, AlertTriangle, Sparkles, Mic, Video, Cpu, ImageIcon, ChevronDown, ChevronUp } from "lucide-react";

const MAX_MB = 25;
const MAX_VIDEO_MB = 100;
const MAX_VIDEO_RECORD_SECONDS = 30;

const STYLE_PREVIEWS: Record<string, string> = {
  sketch: "linear-gradient(135deg, #f3f1ea 0%, #a8a59b 100%)",
  oil_painting: "linear-gradient(135deg, #8c5f21 0%, #e8a54b 50%, #6b4a1a 100%)",
  watercolor: "linear-gradient(135deg, #6a9bb5 0%, #f0d2a4 100%)",
  cyberpunk: "linear-gradient(135deg, #1a0a3d 0%, #e63c8a 50%, #0fe3c6 100%)",
  vintage: "linear-gradient(135deg, #4a3422 0%, #b8805c 100%)",
  duotone: "linear-gradient(135deg, #1e1e50 0%, #f07846 100%)",
  mosaic: "conic-gradient(from 0deg, #e8a54b, #e8663c, #7dc47a, #3a6db7, #e8a54b)",
  pixelate: "repeating-linear-gradient(45deg, #e8a54b 0 12px, #17171a 12px 24px)",
  neon_glow: "linear-gradient(135deg, #0a0a1a 0%, #8b00ff 40%, #00ffff 100%)",
  anime: "linear-gradient(135deg, #ff6bb5 0%, #ffe066 50%, #6bdfff 100%)",
  hdr: "linear-gradient(135deg, #0d0d0d 0%, #ff6600 50%, #ffffff 100%)",
  pop_art: "linear-gradient(135deg, #ff0080 0%, #ffff00 50%, #00ccff 100%)",
  glitch: "linear-gradient(135deg, #ff003c 0%, #00ff9f 50%, #0033ff 100%)",
  thermal: "linear-gradient(135deg, #0000ff 0%, #00ff00 40%, #ff0000 100%)",
  blueprint: "linear-gradient(135deg, #0c1c4e 0%, #1a5276 50%, #64c8ff 100%)",
  infrared: "linear-gradient(135deg, #1a4a1a 0%, #e8ffe8 50%, #ff8c00 100%)",
};

const VIDEO_USAGE_RULES = [
  "For demonstration use only. Upload only your own video or media you are explicitly allowed to edit.",
  "Outputs remain AI-generated examples and must not be used for deception, impersonation, or identity fraud.",
  "Browser recording is limited to 30 seconds per clip to keep the demo stable.",
  "Each uploaded clip can only be transformed once. Upload a new clip to try a different preset.",
];

function getVoicePlaybackRate(preset: string) {
  switch (preset) {
    case "male_to_female":
      return 1.06;
    case "female_to_male":
      return 0.94;
    case "younger":
      return 1.07;
    case "older":
      return 0.93;
    default:
      return 1;
  }
}

function getVoiceFilterProfile(preset: string) {
  switch (preset) {
    case "male_to_female":
      return { lowShelf: -5, highShelf: 4, peaking: 3, compressor: 6 };
    case "female_to_male":
      return { lowShelf: 5, highShelf: -4, peaking: -3, compressor: 8 };
    case "younger":
      return { lowShelf: -4, highShelf: 5, peaking: 4, compressor: 6 };
    case "older":
      return { lowShelf: 4, highShelf: -3, peaking: -3, compressor: 8 };
    default:
      return { lowShelf: 0, highShelf: 0, peaking: 0, compressor: 6 };
  }
}

function audioBufferToWavBlob(buffer: AudioBuffer) {
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const samples = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataSize = samples * blockAlign;
  const wavBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(wavBuffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples; i += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([wavBuffer], { type: "audio/wav" });
}

async function transformVoiceLocally(file: File, preset: string) {
  const AudioContextCtor =
    window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error("Your browser does not support local audio processing.");
  }

  const sourceContext = new AudioContextCtor();
  try {
    const input = await file.arrayBuffer();
    const decoded = await sourceContext.decodeAudioData(input.slice(0));
    const playbackRate = getVoicePlaybackRate(preset);
    const outputLength = Math.max(1, Math.ceil(decoded.length / playbackRate));
    const offline = new OfflineAudioContext(decoded.numberOfChannels, outputLength, decoded.sampleRate);
    const profile = getVoiceFilterProfile(preset);

    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.playbackRate.value = playbackRate;
    source.detune.value =
      preset === "male_to_female"
        ? 280
        : preset === "female_to_male"
          ? -280
          : preset === "younger"
            ? 220
            : preset === "older"
              ? -200
              : 0;

    const lowShelf = offline.createBiquadFilter();
    lowShelf.type = "lowshelf";
    lowShelf.frequency.value = 180;
    lowShelf.gain.value = preset === "female_to_male" || preset === "older" ? 3 : -2;

    const highShelf = offline.createBiquadFilter();
    highShelf.type = "highshelf";
    highShelf.frequency.value = 2800;
    highShelf.gain.value = profile.highShelf;

    const peaking = offline.createBiquadFilter();
    peaking.type = "peaking";
    peaking.frequency.value = preset === "female_to_male" || preset === "older" ? 900 : 2500;
    peaking.Q.value = 0.8;
    peaking.gain.value = profile.peaking;

    const presence = offline.createBiquadFilter();
    presence.type = "peaking";
    presence.frequency.value = preset === "female_to_male" || preset === "older" ? 450 : 3400;
    presence.Q.value = 1.1;
    presence.gain.value =
      preset === "male_to_female"
        ? 2.5
        : preset === "female_to_male"
          ? -2.5
          : preset === "younger"
            ? 3
            : preset === "older"
              ? -2
              : 0;

    const compressor = offline.createDynamicsCompressor();
    compressor.threshold.value = -26;
    compressor.knee.value = 18;
    compressor.ratio.value = profile.compressor;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.18;

    const waveShaper = offline.createWaveShaper();
    const curve = new Float32Array(1024);
    const drive =
      preset === "female_to_male"
        ? 1.3
        : preset === "older"
          ? 1.2
          : preset === "younger"
            ? 1.1
            : 1.05;
    for (let i = 0; i < curve.length; i += 1) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * drive);
    }
    waveShaper.curve = curve;
    waveShaper.oversample = "4x";

    source.connect(lowShelf);
    lowShelf.connect(highShelf);
    highShelf.connect(peaking);
    peaking.connect(presence);
    presence.connect(compressor);
    compressor.connect(waveShaper);
    waveShaper.connect(offline.destination);
    source.start(0);

    const rendered = await offline.startRendering();
    return audioBufferToWavBlob(rendered);
  } finally {
    await sourceContext.close();
  }
}

export default function LabPage() {
  return (
    <ProtectedRoute>
      <AppShell>
        <LabInner />
      </AppShell>
    </ProtectedRoute>
  );
}

function LabInner() {
  const [activeTab, setActiveTab] = useState<"image" | "voice" | "video" | "ai">("image");
  
  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-end justify-between flex-wrap gap-4 mb-10">
        <div>
          <div className="label mb-2 flex items-center gap-2">
            <Wand2 className="h-3.5 w-3.5" strokeWidth={1.5} />
            Transformation Lab
          </div>
          <h1 className="text-display text-4xl md:text-5xl tracking-[-0.025em]">
            Stylize responsibly.
          </h1>
          <p className="mt-3 text-sm text-ink-secondary max-w-2xl">
            A sandbox for obvious, watermarked synthetic stylization. No face-swap, no identity copying.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-8 border-b border-border">
        <button
          onClick={() => setActiveTab("image")}
          className={cn(
            "px-4 py-3 text-sm font-medium transition-all border-b-2 -mb-px",
            activeTab === "image"
              ? "text-accent-amber border-accent-amber"
              : "text-ink-tertiary border-transparent hover:text-ink-secondary"
          )}
        >
          <Wand2 className="h-4 w-4 inline mr-2" />
          Image Style
        </button>
        <button
          onClick={() => setActiveTab("voice")}
          className={cn(
            "px-4 py-3 text-sm font-medium transition-all border-b-2 -mb-px",
            activeTab === "voice"
              ? "text-accent-amber border-accent-amber"
              : "text-ink-tertiary border-transparent hover:text-ink-secondary"
          )}
        >
          <Mic className="h-4 w-4 inline mr-2" />
          Voice Transform
        </button>
        <button
          onClick={() => setActiveTab("video")}
          className={cn(
            "px-4 py-3 text-sm font-medium transition-all border-b-2 -mb-px",
            activeTab === "video"
              ? "text-accent-amber border-accent-amber"
              : "text-ink-tertiary border-transparent hover:text-ink-secondary"
          )}
        >
          <Video className="h-4 w-4 inline mr-2" />
          Video Transform
        </button>
        <button
          onClick={() => setActiveTab("ai")}
          className={cn(
            "px-4 py-3 text-sm font-medium transition-all border-b-2 -mb-px",
            activeTab === "ai"
              ? "text-accent-amber border-accent-amber"
              : "text-ink-tertiary border-transparent hover:text-ink-secondary"
          )}
        >
          <Cpu className="h-4 w-4 inline mr-2" />
          AI Generate
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === "image" && <ImageTransformTab />}
      {activeTab === "voice" && <VoiceTransformTab />}
      {activeTab === "video" && <VideoTransformTab />}
      {activeTab === "ai" && <AiGenerateTab />}
    </div>
  );
}

// Image Transformation Tab Component
function ImageTransformTab() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [stylesInfo, setStylesInfo] = useState<LabStylesOut | null>(null);
  const [quota, setQuota] = useState<{ used: number; remaining: number; limit: number } | null>(null);
  const [style, setStyle] = useState<string>("sketch");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [consentOwn, setConsentOwn] = useState(false);
  const [consentLabel, setConsentLabel] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ blob: Blob; style_name: string } | null>(null);
  const [resultObjectUrl, setResultObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (result?.blob) {
      const url = URL.createObjectURL(result.blob);
      setResultObjectUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [result?.blob]);

  useEffect(() => {
    (async () => {
      try {
        const [s, q] = await Promise.all([api.labStyles(), api.labQuota()]);
        setStylesInfo(s);
        setQuota(q);
        if (s.styles[0]) setStyle(s.styles[0].id);
      } catch {
        toast.error("Could not load lab info");
      }
    })();
  }, []);

  const accept = useCallback((f: File) => {
    if (!f.type.startsWith("image/")) {
      toast.error("Lab supports images only");
      return;
    }
    if (f.size > MAX_MB * 1024 * 1024) {
      toast.error(`File exceeds ${MAX_MB} MB limit`);
      return;
    }
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setResult(null);
  }, []);

  function clearFile() {
    if (preview) URL.revokeObjectURL(preview);
    setFile(null);
    setPreview(null);
    setResult(null);
  }

  async function run() {
    if (!file) return;
    if (!consentOwn || !consentLabel) {
      toast.error("Both consents are required to run a transformation.");
      return;
    }
    setLoading(true);
    try {
      const res = await api.labTransform(file, style);
      const downloadUrl = buildBackendUrl(res.download_url);
      
      const token = typeof window !== 'undefined' ? sessionStorage.getItem("artframe_token") : null;
      const headers: HeadersInit = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      
      const imageRes = await fetch(downloadUrl, { headers });
      if (!imageRes.ok) {
        throw new Error(`Failed to fetch image: ${imageRes.statusText}`);
      }
      
      const blob = await imageRes.blob();
      setResult({
        blob,
        style_name: res.style_name,
      });
      toast.success("Transformation complete — watermarked and ready");
      const q = await api.labQuota();
      setQuota(q);
    } catch (err) {
      const msg = err instanceof ApiError ? err.detail : "Transformation failed";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-7 space-y-6">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const f = e.dataTransfer.files[0];
            if (f) accept(f);
          }}
          onClick={() => !file && inputRef.current?.click()}
          className={cn(
            "relative border-2 border-dashed rounded-xl transition-all cursor-pointer overflow-hidden",
            over ? "border-accent-amber bg-accent-amber/5" : "border-border hover:border-border-strong",
            file ? "p-5" : "p-10 text-center"
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) accept(f);
            }}
          />
          {!file ? (
            <>
              <UploadCloud className="h-8 w-8 text-accent-amber mx-auto mb-3" strokeWidth={1.5} />
              <div className="text-sm text-ink-primary font-medium">Drop an image to stylize</div>
              <div className="text-xs text-ink-tertiary mt-1">Up to {MAX_MB}MB · jpg/png/webp</div>
            </>
          ) : (
            <div className="flex items-start gap-4">
              {preview && (
                <img src={preview} alt="" className="w-24 h-24 object-cover rounded-lg border border-border-subtle shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-ink-primary truncate">{file.name}</div>
                    <div className="text-xs text-ink-tertiary mt-0.5">{formatBytes(file.size)}</div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      clearFile();
                    }}
                    className="text-ink-tertiary hover:text-ink-primary"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="label mb-3">Choose a style</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {stylesInfo?.styles.map((s) => (
              <button
                key={s.id}
                onClick={() => setStyle(s.id)}
                className={cn(
                  "card p-3 text-left transition-all",
                  style === s.id
                    ? "border-accent-amber bg-accent-amber/5 ring-1 ring-accent-amber/30"
                    : "hover:border-border-strong"
                )}
              >
                <div
                  className="h-16 w-full rounded-md mb-2"
                  style={{ background: STYLE_PREVIEWS[s.id] || "#2a2a2f" }}
                />
                <div className="text-xs text-ink-primary font-medium">{s.name}</div>
              </button>
            ))}
          </div>
        </div>

        {file && (
          <div className="card p-5 space-y-3 bg-bg-surface/50">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={consentOwn}
                onChange={(e) => setConsentOwn(e.target.checked)}
                disabled={loading}
                className="mt-0.5 h-4 w-4 accent-accent-amber"
              />
              <div className="text-sm text-ink-primary">
                <ShieldCheck className="inline h-4 w-4 text-accent-amber mr-1" strokeWidth={1.5} />
                This image is mine or I have the right to transform it.
              </div>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={consentLabel}
                onChange={(e) => setConsentLabel(e.target.checked)}
                disabled={loading}
                className="mt-0.5 h-4 w-4 accent-accent-amber"
              />
              <div className="text-sm text-ink-primary">
                <Sparkles className="inline h-4 w-4 text-accent-amber mr-1" strokeWidth={1.5} />
                I accept that the output is watermarked "AI-GENERATED" and will not be used to deceive.
              </div>
            </label>
          </div>
        )}

        {file && (
          <button
            onClick={run}
            disabled={loading || !consentOwn || !consentLabel}
            className="btn-primary w-full"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Stylizing…
              </>
            ) : (
              <>
                <Wand2 className="h-4 w-4" /> Run transformation
              </>
            )}
          </button>
        )}
      </div>

      <div className="lg:col-span-5">
        <div className="lg:sticky lg:top-24">
          <div className="label mb-3">Output</div>
          <div className="card-elevated p-4 min-h-[380px] flex flex-col">
            {result ? (
              <>
                <div className="relative flex-1 rounded-md overflow-hidden mb-3 bg-bg-inset">
                  <img
                    src={resultObjectUrl || undefined}
                    alt="Transformed"
                    className="w-full h-full object-contain"
                  />
                </div>
                <div className="text-xs text-ink-tertiary mb-3">
                  Style: <span className="text-accent-amber">{result.style_name}</span> · watermarked
                </div>
                <a href={resultObjectUrl || undefined} download="artframe-transformed.jpg" className="btn-primary w-full text-sm">
                  <Download className="h-4 w-4" /> Download
                </a>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-10 border-2 border-dashed border-border-subtle rounded-md">
                <Wand2 className="h-8 w-8 text-ink-tertiary mb-3" strokeWidth={1} />
                <div className="text-sm text-ink-secondary">No transformation yet</div>
                <div className="text-xs text-ink-tertiary mt-1 px-6">
                  Your watermarked output will appear here
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Voice Transformation Tab Component
function VoiceTransformTab() {
  const inputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  const [voicePresets, setVoicePresets] = useState<VoicePresetsOut | null>(null);
  const [preset, setPreset] = useState<string>("male_to_female");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ blob: Blob; engine: string } | null>(null);
  const [resultObjectUrl, setResultObjectUrl] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [consentOwn, setConsentOwn] = useState(false);
  const [consentLabel, setConsentLabel] = useState(false);

  useEffect(() => {
    if (result?.blob) {
      const url = URL.createObjectURL(result.blob);
      setResultObjectUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [result?.blob]);

  useEffect(() => {
    (async () => {
      try {
        const presets = await api.voicePresets();
        setVoicePresets(presets);
        if (presets.presets[0]) setPreset(presets.presets[0].id);
      } catch {
        toast.error("Could not load voice presets");
      }
    })();
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Try to use WAV format if supported, fallback to default
      const options: MediaRecorderOptions = {};
      const mimeTypes = ['audio/wav', 'audio/webm', 'audio/ogg', 'audio/mp4'];
      for (const mimeType of mimeTypes) {
        if (MediaRecorder.isTypeSupported(mimeType)) {
          options.mimeType = mimeType;
          break;
        }
      }
      
      mediaRecorderRef.current = new MediaRecorder(stream, options);
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (e) => {
        audioChunksRef.current.push(e.data);
      };

      mediaRecorderRef.current.onstop = () => {
        // Determine the actual mime type and proper extension
        const mimeType = mediaRecorderRef.current?.mimeType || "audio/wav";
        const ext = (() => {
          if (mimeType.includes('wav')) return 'wav';
          if (mimeType.includes('webm')) return 'webm';
          if (mimeType.includes('ogg')) return 'ogg';
          if (mimeType.includes('mp4')) return 'm4a';
          return 'wav';
        })();

        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        const filename = `recording_${Date.now()}.${ext}`;
        const recordedFile = new File([audioBlob], filename, { type: mimeType });
        // Use acceptFile so consent checkboxes and result are properly reset
        acceptFile(recordedFile);
        toast.success("Recording finished");
        setIsRecording(false);

        // Clean up stream
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
      setRecordingTime(0);
      
      recordingIntervalRef.current = setInterval(() => {
        setRecordingTime((t) => {
          if (t >= 120) {
            stopRecording();
            return t;
          }
          return t + 1;
        });
      }, 1000);
    } catch (err) {
      toast.error("Could not access microphone");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
  };

  const acceptFile = useCallback((f: File) => {
    if (!f.type.startsWith("audio/")) {
      toast.error("Only audio files are supported");
      return;
    }
    if (f.size > 25 * 1024 * 1024) {
      toast.error("File exceeds 25 MB limit");
      return;
    }
    setFile(f);
    setPreview(f.name);
    setResult(null);
    setConsentOwn(false);
    setConsentLabel(false);
  }, []);

  const transform = async () => {
    if (!file) return;
    setLoading(true);
    try {
      const res = await api.transformVoice(file, preset);
      let blob: Blob;
      if (res.audio_base64) {
        const binary = atob(res.audio_base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
          bytes[i] = binary.charCodeAt(i);
        }
        blob = new Blob([bytes], { type: res.mime_type || "audio/wav" });
      } else {
        const downloadUrl = buildBackendUrl(res.download_url);
        const token = typeof window !== 'undefined' ? sessionStorage.getItem("artframe_token") : null;
        const headers: HeadersInit = {};
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }

        const audioRes = await fetch(downloadUrl, { headers });
        if (!audioRes.ok) {
          throw new Error(`Failed to fetch audio: ${audioRes.statusText}`);
        }
        blob = await audioRes.blob();
      }

      const engineLabel = res.model_id
        ? `${res.engine || "backend-voice-transform"} • ${res.model_id}`
        : (res.engine || "backend-voice-transform");
      setResult({ blob, engine: engineLabel });
      toast.success("Voice transformation complete");
    } catch (err) {
      console.error("Voice transform error:", err);
      try {
        const fallbackBlob = await transformVoiceLocally(file, preset);
        setResult({ blob: fallbackBlob, engine: "local-browser-fallback" });
        toast.success("Voice transformation complete (local fallback)");
      } catch (fallbackError) {
        console.error("Local voice fallback error:", fallbackError);
        const msg =
          err instanceof ApiError
            ? err.detail
            : err instanceof Error
              ? err.message
              : "Transformation failed";
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-7 space-y-6">
        {/* Recording or File Upload */}
        <div className="card p-6 bg-bg-surface/50">
          <div className="label mb-4">Record or Upload Audio</div>
          <div className="space-y-4">
            {!isRecording && !file ? (
              <>
                <button
                  onClick={startRecording}
                  className="btn-primary w-full"
                >
                  <Mic className="h-4 w-4" /> Start Recording
                </button>
                <div className="text-center text-ink-tertiary text-sm">or</div>
                <div
                  onClick={() => inputRef.current?.click()}
                  className="border-2 border-dashed border-border hover:border-border-strong rounded-lg p-6 text-center cursor-pointer transition-all"
                >
                  <UploadCloud className="h-6 w-6 text-accent-amber mx-auto mb-2" strokeWidth={1.5} />
                  <div className="text-sm text-ink-primary font-medium">Click to upload audio</div>
                  <div className="text-xs text-ink-tertiary mt-1">MP3, WAV up to 25MB</div>
                </div>
                <input
                  ref={inputRef}
                  type="file"
                  accept="audio/*"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) acceptFile(f);
                  }}
                />
              </>
            ) : isRecording ? (
              <div className="text-center">
                <div className="text-4xl font-mono text-accent-amber mb-4">
                  {Math.floor(recordingTime / 60)}:{String(recordingTime % 60).padStart(2, "0")}
                </div>
                <button
                  onClick={stopRecording}
                  className="btn-primary w-full bg-red-600 hover:bg-red-700"
                >
                  <X className="h-4 w-4" /> Stop Recording
                </button>
              </div>
            ) : file ? (
              <div className="flex items-center justify-between p-4 bg-bg-inset rounded-lg">
                <div>
                  <div className="font-medium text-ink-primary">{preview}</div>
                  <div className="text-xs text-ink-tertiary mt-1">{formatBytes(file.size)}</div>
                </div>
                <button
                  onClick={() => {
                    setFile(null);
                    setPreview(null);
                    setResult(null);
                    setConsentOwn(false);
                    setConsentLabel(false);
                  }}
                  className="text-ink-tertiary hover:text-ink-primary"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {/* Preset Selection */}
        {file && (
          <div>
            <div className="label mb-3">Choose a voice edit</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {voicePresets?.presets.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPreset(p.id)}
                  className={cn(
                    "card p-4 text-left transition-all",
                    preset === p.id
                      ? "border-accent-amber bg-accent-amber/5 ring-1 ring-accent-amber/30"
                      : "hover:border-border-strong"
                  )}
                >
                  <div className="font-medium text-sm text-ink-primary">{p.name}</div>
                  <div className="text-xs text-ink-tertiary mt-1">{p.description}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {file && (
          <div className="card p-5 space-y-3 bg-bg-surface/50">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={consentOwn}
                onChange={(e) => setConsentOwn(e.target.checked)}
                disabled={loading}
                className="mt-0.5 h-4 w-4 accent-accent-amber"
              />
              <div className="text-sm text-ink-primary">
                <ShieldCheck className="inline h-4 w-4 text-accent-amber mr-1" strokeWidth={1.5} />
                This audio is mine or I have the right to transform it.
              </div>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={consentLabel}
                onChange={(e) => setConsentLabel(e.target.checked)}
                disabled={loading}
                className="mt-0.5 h-4 w-4 accent-accent-amber"
              />
              <div className="text-sm text-ink-primary">
                <Sparkles className="inline h-4 w-4 text-accent-amber mr-1" strokeWidth={1.5} />
                I accept that the output is AI-generated and will not be used to deceive or impersonate.
              </div>
            </label>
          </div>
        )}

        {file && (
          <button
            onClick={transform}
            disabled={loading || !consentOwn || !consentLabel}
            className="btn-primary w-full"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Transforming…
              </>
            ) : (
              <>
                <Wand2 className="h-4 w-4" /> Transform Voice
              </>
            )}
          </button>
        )}
      </div>

      <div className="lg:col-span-5">
        <div className="lg:sticky lg:top-24">
          <div className="label mb-3">Output</div>
          <div className="card-elevated p-4 min-h-[300px] flex flex-col">
            {result ? (
              <>
                <div className="flex-1 flex flex-col items-center justify-center mb-4">
                  <Mic className="h-12 w-12 text-accent-amber mb-3" strokeWidth={1} />
                  <div className="text-sm text-ink-secondary">Audio ready</div>
                  <div className="text-xs text-ink-tertiary mt-1">{result.engine}</div>
                </div>
                <audio
                  src={resultObjectUrl || undefined}
                  controls
                  className="w-full mb-4"
                />
                <a href={resultObjectUrl || undefined} download="artframe-voice.wav" className="btn-primary w-full text-sm">
                  <Download className="h-4 w-4" /> Download
                </a>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-10 border-2 border-dashed border-border-subtle rounded-md">
                <Mic className="h-8 w-8 text-ink-tertiary mb-3" strokeWidth={1} />
                <div className="text-sm text-ink-secondary">No transformation yet</div>
                <div className="text-xs text-ink-tertiary mt-1 px-6">
                  Your transformed voice will appear here
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AiGenerateTab() {
  const [status, setStatus] = useState<{ configured: boolean; model: string } | null>(null);
  const [quota, setQuota] = useState<{ used: number; remaining: number; limit: number } | null>(null);
  const [openSection, setOpenSection] = useState<"image" | "transform" | "video" | null>("image");

  useEffect(() => {
    (async () => {
      try {
        const [s, q] = await Promise.all([api.aiStatus(), api.aiQuota()]);
        setStatus(s);
        setQuota(q);
      } catch {
        const s = await api.aiStatus().catch(() => ({ configured: false, model: "" }));
        setStatus(s);
      }
    })();
  }, []);

  if (status === null) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-ink-tertiary" />
      </div>
    );
  }

  if (!status.configured) {
    return (
      <div className="card p-8 max-w-2xl mx-auto text-center space-y-4">
        <AlertTriangle className="h-10 w-10 text-accent-amber mx-auto" strokeWidth={1.5} />
        <h2 className="text-xl font-semibold text-ink-primary">AI Generation Not Configured</h2>
        <p className="text-sm text-ink-secondary leading-relaxed">
          To enable AI image and video generation, add your Gemini API key to the backend:
        </p>
        <div className="rounded-lg bg-bg-inset p-4 text-left font-mono text-xs text-ink-secondary">
          <div className="text-ink-tertiary mb-1"># backend/.env</div>
          <div className="text-accent-amber">GEMINI_API_KEY=your-key-here</div>
        </div>
        <p className="text-xs text-ink-tertiary">
          Then restart the backend server.{" "}
          <a
            href="https://aistudio.google.com/app/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-ink-primary"
          >
            Get your free key at aistudio.google.com
          </a>
        </p>
      </div>
    );
  }

  const toggleSection = (s: "image" | "transform" | "video") =>
    setOpenSection((prev) => (prev === s ? null : s));

  const onQuotaUsed = () => {
    api.aiQuota().then(setQuota).catch(() => undefined);
  };

  return (
    <div className="space-y-4 max-w-4xl">
      {quota && (
        <div className="flex items-center justify-end gap-2 text-xs text-ink-tertiary">
          <Cpu className="h-3.5 w-3.5" strokeWidth={1.5} />
          <span>
            AI credits:{" "}
            <span className={quota.remaining === 0 ? "text-signal-ai" : "text-accent-amber"}>
              {quota.remaining}/{quota.limit}
            </span>{" "}
            remaining today
          </span>
        </div>
      )}

      <div className="card overflow-hidden">
        <button
          onClick={() => toggleSection("image")}
          className="w-full flex items-center justify-between p-5 text-left hover:bg-bg-surface/30 transition-colors"
        >
          <div className="flex items-center gap-3">
            <ImageIcon className="h-4 w-4 text-accent-amber" strokeWidth={1.5} />
            <span className="font-medium text-ink-primary">Text-to-Image</span>
            <span className="text-xs text-ink-tertiary">Generate any image from a prompt</span>
          </div>
          {openSection === "image" ? <ChevronUp className="h-4 w-4 text-ink-tertiary" /> : <ChevronDown className="h-4 w-4 text-ink-tertiary" />}
        </button>
        {openSection === "image" && (
          <div className="border-t border-border-subtle p-5">
            <TextToImageSection onQuotaUsed={onQuotaUsed} quotaRemaining={quota?.remaining ?? 0} />
          </div>
        )}
      </div>

      <div className="card overflow-hidden">
        <button
          onClick={() => toggleSection("transform")}
          className="w-full flex items-center justify-between p-5 text-left hover:bg-bg-surface/30 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Wand2 className="h-4 w-4 text-accent-amber" strokeWidth={1.5} />
            <span className="font-medium text-ink-primary">AI Image Transform</span>
            <span className="text-xs text-ink-tertiary">Upload an image + describe the change</span>
          </div>
          {openSection === "transform" ? <ChevronUp className="h-4 w-4 text-ink-tertiary" /> : <ChevronDown className="h-4 w-4 text-ink-tertiary" />}
        </button>
        {openSection === "transform" && (
          <div className="border-t border-border-subtle p-5">
            <AiImageTransformSection onQuotaUsed={onQuotaUsed} quotaRemaining={quota?.remaining ?? 0} />
          </div>
        )}
      </div>

      <div className="card overflow-hidden">
        <button
          onClick={() => toggleSection("video")}
          className="w-full flex items-center justify-between p-5 text-left hover:bg-bg-surface/30 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Video className="h-4 w-4 text-accent-amber" strokeWidth={1.5} />
            <span className="font-medium text-ink-primary">Text-to-Video</span>
            <span className="text-xs text-ink-tertiary">Generate a short video — 1 attempt per session</span>
          </div>
          {openSection === "video" ? <ChevronUp className="h-4 w-4 text-ink-tertiary" /> : <ChevronDown className="h-4 w-4 text-ink-tertiary" />}
        </button>
        {openSection === "video" && (
          <div className="border-t border-border-subtle p-5">
            <TextToVideoSection onQuotaUsed={onQuotaUsed} quotaRemaining={quota?.remaining ?? 0} />
          </div>
        )}
      </div>
    </div>
  );
}

function TextToImageSection({ onQuotaUsed, quotaRemaining }: { onQuotaUsed: () => void; quotaRemaining: number }) {
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState<"square" | "landscape" | "portrait">("square");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ blob: Blob } | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  useEffect(() => {
    if (result?.blob) {
      const url = URL.createObjectURL(result.blob);
      setResultUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [result?.blob]);

  const generate = async () => {
    if (!prompt.trim()) { toast.error("Enter a prompt first"); return; }
    if (quotaRemaining <= 0) { toast.error("No AI credits remaining today"); return; }
    setLoading(true);
    try {
      const res = await api.aiGenerateImage(prompt.trim(), aspect);
      const binary = atob(res.image_base64);
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: res.mime_type });
      setResult({ blob });
      onQuotaUsed();
      toast.success("Image generated");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail : "Generation failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={500}
          rows={4}
          placeholder="A serene Japanese garden at sunset, cherry blossoms falling..."
          className="w-full rounded-lg border border-border bg-bg-inset px-4 py-3 text-sm text-ink-primary placeholder:text-ink-tertiary focus:outline-none focus:border-accent-amber resize-none"
        />
        <div className="text-xs text-ink-tertiary text-right">{prompt.length}/500</div>
        <div>
          <div className="label mb-2">Aspect ratio</div>
          <div className="flex gap-2">
            {(["square", "landscape", "portrait"] as const).map((a) => (
              <button
                key={a}
                onClick={() => setAspect(a)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium border transition-all capitalize",
                  aspect === a
                    ? "border-accent-amber text-accent-amber bg-accent-amber/10"
                    : "border-border text-ink-tertiary hover:border-border-strong"
                )}
              >
                {a}
              </button>
            ))}
          </div>
        </div>
        <button onClick={generate} disabled={loading || !prompt.trim()} className="btn-primary w-full">
          {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating...</> : <><Sparkles className="h-4 w-4" /> Generate Image</>}
        </button>
      </div>
      <div className="card-elevated p-4 min-h-[220px] flex flex-col">
        {result && resultUrl ? (
          <>
            <img src={resultUrl} alt="Generated" className="w-full rounded-md object-contain mb-3 flex-1" />
            <a href={resultUrl} download="artframe-ai-image.jpg" className="btn-primary w-full text-sm">
              <Download className="h-4 w-4" /> Download
            </a>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center border-2 border-dashed border-border-subtle rounded-md py-8">
            <Sparkles className="h-8 w-8 text-ink-tertiary mb-3" strokeWidth={1} />
            <div className="text-sm text-ink-secondary">Output appears here</div>
          </div>
        )}
      </div>
    </div>
  );
}

function AiImageTransformSection({ onQuotaUsed, quotaRemaining }: { onQuotaUsed: () => void; quotaRemaining: number }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ blob: Blob } | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  useEffect(() => {
    if (result?.blob) {
      const url = URL.createObjectURL(result.blob);
      setResultUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [result?.blob]);

  const acceptFile = (f: File) => {
    if (!f.type.startsWith("image/")) { toast.error("Images only"); return; }
    if (f.size > 10 * 1024 * 1024) { toast.error("Max 10 MB"); return; }
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setResult(null);
  };

  const transform = async () => {
    if (!file || !instruction.trim()) { toast.error("Upload an image and describe the transformation"); return; }
    if (quotaRemaining <= 0) { toast.error("No AI credits remaining today"); return; }
    setLoading(true);
    try {
      const res = await api.aiTransformImage(file, instruction.trim());
      const binary = atob(res.image_base64);
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      setResult({ blob: new Blob([bytes], { type: res.mime_type }) });
      onQuotaUsed();
      toast.success("Image transformed by AI");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail : "Transform failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <div
          onClick={() => !file && inputRef.current?.click()}
          className={cn("border-2 border-dashed rounded-xl transition-all cursor-pointer", file ? "p-4" : "p-8 text-center hover:border-border-strong")}
        >
          <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) acceptFile(f); }} />
          {file && preview ? (
            <div className="flex items-center gap-3">
              <img src={preview} alt="" className="w-16 h-16 object-cover rounded" />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-ink-primary truncate">{file.name}</div>
              </div>
              <button onClick={(e) => { e.stopPropagation(); setFile(null); setPreview(null); setResult(null); }} className="text-ink-tertiary hover:text-ink-primary">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <>
              <UploadCloud className="h-7 w-7 text-accent-amber mx-auto mb-2" strokeWidth={1.5} />
              <div className="text-sm text-ink-primary font-medium">Upload an image</div>
              <div className="text-xs text-ink-tertiary mt-1">jpg/png/webp up to 10 MB</div>
            </>
          )}
        </div>
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          maxLength={300}
          rows={3}
          placeholder='e.g. "make it look like a Van Gogh painting" or "transform into cyberpunk style"'
          className="w-full rounded-lg border border-border bg-bg-inset px-4 py-3 text-sm text-ink-primary placeholder:text-ink-tertiary focus:outline-none focus:border-accent-amber resize-none"
        />
        <div className="text-xs text-ink-tertiary text-right">{instruction.length}/300</div>
        <button onClick={transform} disabled={loading || !file || !instruction.trim()} className="btn-primary w-full">
          {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Transforming...</> : <><Wand2 className="h-4 w-4" /> Transform with AI</>}
        </button>
      </div>
      <div className="card-elevated p-4 min-h-[220px] flex flex-col">
        {result && resultUrl ? (
          <>
            <img src={resultUrl} alt="Transformed" className="w-full rounded-md object-contain mb-3 flex-1" />
            <a href={resultUrl} download="artframe-ai-transform.jpg" className="btn-primary w-full text-sm">
              <Download className="h-4 w-4" /> Download
            </a>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center border-2 border-dashed border-border-subtle rounded-md py-8">
            <Wand2 className="h-8 w-8 text-ink-tertiary mb-3" strokeWidth={1} />
            <div className="text-sm text-ink-secondary">Transformed image appears here</div>
          </div>
        )}
      </div>
    </div>
  );
}

function TextToVideoSection({ onQuotaUsed, quotaRemaining }: { onQuotaUsed: () => void; quotaRemaining: number }) {
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState<3 | 5>(3);
  const [loading, setLoading] = useState(false);
  const [hasAttempted, setHasAttempted] = useState(false);
  const [result, setResult] = useState<{ blob: Blob; disclaimer: string; frames: number } | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  useEffect(() => {
    if (result?.blob) {
      const url = URL.createObjectURL(result.blob);
      setResultUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [result?.blob]);

  const generate = async () => {
    if (!prompt.trim()) { toast.error("Enter a prompt first"); return; }
    if (quotaRemaining <= 0) { toast.error("No AI credits remaining today"); return; }
    setHasAttempted(true);
    setLoading(true);
    try {
      const res = await api.aiGenerateVideo(prompt.trim(), duration);
      const binary = atob(res.video_base64);
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      setResult({ blob: new Blob([bytes], { type: res.mime_type }), disclaimer: res.disclaimer, frames: res.frames_generated });
      onQuotaUsed();
      toast.success(`Video generated — ${res.frames_generated} frames`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail : "Video generation failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <div className="rounded-lg border border-accent-amber/30 bg-accent-amber/5 p-3 text-xs text-ink-secondary flex gap-2">
          <AlertTriangle className="h-4 w-4 text-accent-amber shrink-0 mt-0.5" strokeWidth={1.5} />
          <span>Experimental feature. Each attempt uses multiple AI credits. Limited to 1 attempt per session.</span>
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={300}
          rows={4}
          disabled={hasAttempted}
          placeholder="A time-lapse of a flower blooming in a sunlit meadow..."
          className="w-full rounded-lg border border-border bg-bg-inset px-4 py-3 text-sm text-ink-primary placeholder:text-ink-tertiary focus:outline-none focus:border-accent-amber resize-none disabled:opacity-50"
        />
        <div className="text-xs text-ink-tertiary text-right">{prompt.length}/300</div>
        <div>
          <div className="label mb-2">Duration</div>
          <div className="flex gap-2">
            {([3, 5] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDuration(d)}
                disabled={hasAttempted}
                className={cn(
                  "px-4 py-1.5 rounded-md text-xs font-medium border transition-all",
                  duration === d ? "border-accent-amber text-accent-amber bg-accent-amber/10" : "border-border text-ink-tertiary hover:border-border-strong",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              >
                {d}s
              </button>
            ))}
          </div>
        </div>
        <button onClick={generate} disabled={loading || !prompt.trim() || hasAttempted} className="btn-primary w-full">
          {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating {duration}s video...</> : <><Video className="h-4 w-4" /> Generate Video</>}
        </button>
        {hasAttempted && !loading && (
          <p className="text-xs text-ink-tertiary text-center">
            1-attempt limit reached. Reload the page to try again with a new prompt.
          </p>
        )}
      </div>
      <div className="card-elevated p-4 min-h-[220px] flex flex-col">
        {result && resultUrl ? (
          <>
            <video src={resultUrl} controls className="w-full rounded-md bg-black mb-3 flex-1" />
            <div className="text-xs text-ink-tertiary mb-3">{result.disclaimer}</div>
            <a href={resultUrl} download="artframe-ai-video.mp4" className="btn-primary w-full text-sm">
              <Download className="h-4 w-4" /> Download
            </a>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center border-2 border-dashed border-border-subtle rounded-md py-8">
            <Video className="h-8 w-8 text-ink-tertiary mb-3" strokeWidth={1} />
            <div className="text-sm text-ink-secondary">Generated video appears here</div>
            <div className="text-xs text-ink-tertiary mt-1 px-4">AI generates keyframes, stitched into MP4</div>
          </div>
        )}
      </div>
    </div>
  );
}

// Video Transformation Tab Component
function VideoTransformTab() {
  const inputRef = useRef<HTMLInputElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const liveStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  const [videoPresets, setVideoPresets] = useState<VideoPresetsOut | null>(null);
  const [preset, setPreset] = useState<string>("gender_female");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ name: string; url: string | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasAttempted, setHasAttempted] = useState(false);
  const [result, setResult] = useState<{
    blob: Blob;
    analysis: {
      ai_probability: number;
      confidence: number;
      verdict: string;
      reasons: string;
    };
    disclaimer: string;
    engine: string;
  } | null>(null);
  const [resultObjectUrl, setResultObjectUrl] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [consentOwn, setConsentOwn] = useState(false);
  const [consentLabel, setConsentLabel] = useState(false);

  useEffect(() => {
    if (result?.blob) {
      const url = URL.createObjectURL(result.blob);
      setResultObjectUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [result?.blob]);

  useEffect(() => {
    (async () => {
      try {
        const presets = await api.videoPresets();
        setVideoPresets(presets);
        if (presets.presets[0]) setPreset(presets.presets[0].id);
      } catch {
        toast.error("Could not load video presets");
      }
    })();
  }, []);

  useEffect(() => {
    return () => {
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
      if (liveStreamRef.current) {
        liveStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (preview?.url) {
        URL.revokeObjectURL(preview.url);
      }
    };
  }, [preview?.url]);

  const acceptFile = useCallback((f: File) => {
    if (!f.type.startsWith("video/")) {
      toast.error("Only video files are supported");
      return;
    }
    if (f.size > MAX_VIDEO_MB * 1024 * 1024) {
      toast.error("File exceeds 100 MB limit");
      return;
    }
    if (preview?.url) {
      URL.revokeObjectURL(preview.url);
    }
    setFile(f);
    setPreview({ name: f.name, url: URL.createObjectURL(f) });
    setResult(null);
    setConsentOwn(false);
    setConsentLabel(false);
    setHasAttempted(false);
  }, [preview?.url]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
    setIsRecording(false);
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      const options: MediaRecorderOptions = {};
      const mimeTypes = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"];
      for (const mimeType of mimeTypes) {
        if (MediaRecorder.isTypeSupported(mimeType)) {
          options.mimeType = mimeType;
          break;
        }
      }

      recordedChunksRef.current = [];
      mediaRecorderRef.current = new MediaRecorder(stream, options);
      liveStreamRef.current = stream;

      if (previewVideoRef.current) {
        previewVideoRef.current.srcObject = stream;
        previewVideoRef.current.muted = true;
        previewVideoRef.current.autoplay = true;
        previewVideoRef.current.onloadedmetadata = () => {
          void previewVideoRef.current?.play().catch(() => undefined);
        };
      }

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorderRef.current.onstop = () => {
        const mimeType = mediaRecorderRef.current?.mimeType || "video/webm";
        const extension = mimeType.includes("mp4") ? "mp4" : "webm";
        const videoBlob = new Blob(recordedChunksRef.current, { type: mimeType });
        const recordedFile = new File([videoBlob], `recording_${Date.now()}.${extension}`, { type: mimeType });
        stream.getTracks().forEach((track) => track.stop());
        liveStreamRef.current = null;
        if (previewVideoRef.current) {
          previewVideoRef.current.srcObject = null;
        }
        acceptFile(recordedFile);
        toast.success("Recording finished");
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
      setRecordingTime(0);

      recordingIntervalRef.current = setInterval(() => {
        setRecordingTime((current) => {
          if (current + 1 >= MAX_VIDEO_RECORD_SECONDS) {
            stopRecording();
          }
          return current + 1;
        });
      }, 1000);
    } catch {
      toast.error("Could not access the camera");
    }
  };

  const transform = async () => {
    if (!file) return;
    if (!consentOwn || !consentLabel) {
      toast.error("You need to accept both usage conditions first.");
      return;
    }
    setHasAttempted(true);
    setLoading(true);
    try {
      const res = await api.transformVideo(file, preset, 0, 0, 0, 0, 0, 0, "original", consentOwn, consentLabel);
      let blob: Blob | null = null;

      if (res.video_base64) {
        const binary = atob(res.video_base64);
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        blob = new Blob([bytes], { type: res.mime_type || "video/mp4" });
      } else {
        const downloadUrl = buildBackendUrl(res.download_url);
        const token = typeof window !== "undefined" ? sessionStorage.getItem("artframe_token") : null;
        const headers: HeadersInit = {};
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }

        const videoRes = await fetch(downloadUrl, { headers });
        if (!videoRes.ok) {
          throw new Error("Failed to fetch video");
        }
        blob = await videoRes.blob();
      }

      setResult({
        blob,
        analysis: res.analysis,
        disclaimer: res.disclaimer,
        engine: res.engine,
      });
      toast.success("Video transformation complete");
    } catch (err) {
      const msg = err instanceof ApiError ? err.detail : "Transformation failed";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-7 space-y-6">
        {/* Upload */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const f = e.dataTransfer.files[0];
            if (f) acceptFile(f);
          }}
          onClick={() => !file && inputRef.current?.click()}
          className={cn(
            "relative border-2 border-dashed rounded-xl transition-all cursor-pointer overflow-hidden",
            over ? "border-accent-amber bg-accent-amber/5" : "border-border hover:border-border-strong",
            file ? "p-5" : "p-10 text-center"
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) acceptFile(f);
            }}
          />
          {!file && !isRecording ? (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void startRecording();
                }}
                className="btn-primary mb-4"
              >
                <Video className="h-4 w-4" /> Record video
              </button>
              <div className="text-xs text-ink-tertiary mb-4">or upload an existing clip</div>
              <UploadCloud className="h-8 w-8 text-accent-amber mx-auto mb-3" strokeWidth={1.5} />
              <div className="text-sm text-ink-primary font-medium">Drop a video to transform</div>
              <div className="text-xs text-ink-tertiary mt-1">MP4, MOV, AVI, WebM up to 100MB</div>
            </>
          ) : isRecording ? (
            <div className="space-y-4">
              <video
                ref={previewVideoRef}
                className="w-full rounded-lg bg-bg-elevated aspect-video object-cover"
                playsInline
                autoPlay
                muted
              />
              <div className="flex items-center justify-between gap-4">
                <div className="text-sm text-ink-primary">
                  Recording: <span className="text-accent-amber font-medium">{recordingTime}s / {MAX_VIDEO_RECORD_SECONDS}s</span>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    stopRecording();
                  }}
                  className="btn-primary bg-red-600 hover:bg-red-700"
                >
                  <X className="h-4 w-4" /> Stop
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between p-4">
              <div>
                <div className="font-medium text-ink-primary">{preview?.name}</div>
                <div className="text-xs text-ink-tertiary mt-1">{formatBytes(file?.size ?? 0)}</div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (preview?.url) {
                    URL.revokeObjectURL(preview.url);
                  }
                  setFile(null);
                  setPreview(null);
                  setResult(null);
                  setConsentOwn(false);
                  setConsentLabel(false);
                }}
                className="text-ink-tertiary hover:text-ink-primary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        {!file ? (
          <div className="card p-5 bg-bg-surface/50">
            <div className="label mb-3">Usage rules & limits</div>
            <div className="space-y-2 text-sm text-ink-secondary">
              {VIDEO_USAGE_RULES.map((rule) => (
                <div key={rule} className="flex gap-2">
                  <AlertTriangle className="h-4 w-4 text-accent-amber shrink-0 mt-0.5" strokeWidth={1.5} />
                  <span>{rule}</span>
                </div>
              ))}
            </div>
            {videoPresets?.disclaimer ? (
              <div className="mt-4 rounded-lg border border-border-subtle bg-bg-inset/40 p-3 text-xs text-ink-tertiary">
                {videoPresets.disclaimer}
              </div>
            ) : null}
            {videoPresets?.generation_note ? (
              <div className="mt-3 rounded-lg border border-border-subtle bg-bg-surface/30 p-3 text-xs text-ink-tertiary">
                {videoPresets.generation_note}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Preset Selection */}
        {file && (
          <div>
            <div className="label mb-3">Choose transformation</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {videoPresets?.presets.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPreset(p.id)}
                  className={cn(
                    "card p-4 text-left transition-all",
                    preset === p.id
                      ? "border-accent-amber bg-accent-amber/5 ring-1 ring-accent-amber/30"
                      : "hover:border-border-strong"
                  )}
                >
                  <div className="font-medium text-sm text-ink-primary">{p.name}</div>
                  <div className="text-xs text-ink-tertiary mt-1">{p.description}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {file && (
          <div className="card p-5 space-y-3 bg-bg-surface/50">
            <div className="label">Usage confirmation</div>
            <div className="text-sm text-ink-secondary">
              This is an example/demo editing flow for feminine, masculine, younger, older, or enhanced looks. Please retry freely while testing, but do not use outputs for deception.
            </div>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={consentOwn}
                onChange={(e) => setConsentOwn(e.target.checked)}
                disabled={loading}
                className="mt-0.5 h-4 w-4 accent-accent-amber"
              />
              <div className="text-sm text-ink-primary">
                <ShieldCheck className="inline h-4 w-4 text-accent-amber mr-1" strokeWidth={1.5} />
                This video is mine or I have permission to record and edit it.
              </div>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={consentLabel}
                onChange={(e) => setConsentLabel(e.target.checked)}
                disabled={loading}
                className="mt-0.5 h-4 w-4 accent-accent-amber"
              />
              <div className="text-sm text-ink-primary">
                <Sparkles className="inline h-4 w-4 text-accent-amber mr-1" strokeWidth={1.5} />
                I understand the output is AI-generated and must not be used for deception, impersonation, or identity fraud.
              </div>
            </label>
          </div>
        )}

        {file && preview?.url ? (
          <div className="card p-4 bg-bg-surface/30">
            <div className="label mb-3">Input preview</div>
            <video src={preview.url} controls className="w-full rounded-lg bg-black" />
          </div>
        ) : null}

        {file && (
          <div className="space-y-2">
            <button
              onClick={transform}
              disabled={loading || !consentOwn || !consentLabel || hasAttempted}
              className="btn-primary w-full"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating and analyzing...
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4" /> Generate edited video
                </>
              )}
            </button>
            {hasAttempted && !loading && (
              <p className="text-xs text-ink-tertiary text-center">
                Video transform is limited to 1 attempt per file. Upload a new clip to try again.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="lg:col-span-5">
        <div className="lg:sticky lg:top-24">
          <div className="label mb-3">Output</div>
          <div className="card-elevated p-4 min-h-[300px] flex flex-col">
            {result ? (
              <>
                <div className="relative mb-4">
                  <video
                    src={resultObjectUrl || undefined}
                    controls
                    className="w-full rounded-md bg-black"
                  />
                  <div className="absolute top-3 left-3 rounded-full bg-black/70 px-3 py-1 text-xs text-white backdrop-blur">
                    {Math.round(result.analysis.ai_probability * 100)}% AI probability · {result.analysis.verdict.replace("_", " ")}
                  </div>
                </div>
                <div className="rounded-lg border border-border-subtle bg-bg-surface/40 p-4 text-sm text-ink-secondary space-y-2 mb-4">
                  <div className="text-ink-primary font-medium">Inline video analysis</div>
                  <div>Confidence: {Math.round(result.analysis.confidence * 100)}%</div>
                  <div>{result.analysis.reasons}</div>
                </div>
                <div className="rounded-lg border border-border-subtle bg-bg-surface/30 p-4 text-xs text-ink-tertiary space-y-2 mb-4">
                  <div><span className="text-ink-secondary">Engine:</span> {result.engine}</div>
                  <div>{result.disclaimer}</div>
                </div>
                <a href={resultObjectUrl || undefined} download="artframe-video.mp4" className="btn-primary w-full text-sm">
                  <Download className="h-4 w-4" /> Download
                </a>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-10 border-2 border-dashed border-border-subtle rounded-md">
                <Video className="h-8 w-8 text-ink-tertiary mb-3" strokeWidth={1} />
                <div className="text-sm text-ink-secondary">No transformation yet</div>
                <div className="text-xs text-ink-tertiary mt-1 px-6">
                  Your edited video and its inline analysis will appear here
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
