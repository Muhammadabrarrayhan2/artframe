const RAW_API_URL = process.env.NEXT_PUBLIC_API_URL?.trim();
const API_URL =
  RAW_API_URL ||
  (process.env.NODE_ENV === "development" ? "http://127.0.0.1:8000" : "");
const API_PREFIX = "/api/v1";

export class ApiError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
    this.detail = detail;
  }
}

function readToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem("artframe_token");
}

export function writeToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) sessionStorage.setItem("artframe_token", token);
  else sessionStorage.removeItem("artframe_token");
}

export function buildBackendUrl(path: string) {
  const apiUrl = getApiUrl();
  return new URL(path, `${apiUrl}/`).toString();
}

function getApiUrl() {
  if (!API_URL) {
    throw new Error("NEXT_PUBLIC_API_URL is not configured for this deployment.");
  }

  if (
    typeof window !== "undefined" &&
    window.location.hostname !== "localhost" &&
    window.location.hostname !== "127.0.0.1" &&
    /^(https?:\/\/)?(127\.0\.0\.1|localhost)(:\d+)?$/i.test(API_URL)
  ) {
    throw new Error(
      "NEXT_PUBLIC_API_URL still points to localhost. Set it to your deployed backend URL."
    );
  }

  return API_URL;
}

async function request<T>(
  path: string,
  opts: { method?: string; body?: any; headers?: Record<string, string>; form?: FormData; auth?: boolean } = {}
): Promise<T> {
  const { method = "GET", body, headers = {}, form, auth = true } = opts;
  const apiUrl = getApiUrl();
  const url = `${apiUrl}${API_PREFIX}${path}`;

  const finalHeaders: Record<string, string> = { ...headers };
  if (auth) {
    const token = readToken();
    if (token) finalHeaders["Authorization"] = `Bearer ${token}`;
  }

  let finalBody: BodyInit | undefined;
  if (form) {
    finalBody = form;
  } else if (body !== undefined) {
    finalHeaders["Content-Type"] = "application/json";
    finalBody = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: finalHeaders,
      body: finalBody,
      cache: "no-store",
    });
  } catch {
    throw new Error(
      `Cannot reach API at ${apiUrl}. Check NEXT_PUBLIC_API_URL and backend CORS settings.`
    );
  }

  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const detail = data?.detail || data?.message || res.statusText;
    const msg = Array.isArray(detail) ? detail.map((d: any) => d.msg).join(", ") : String(detail);
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

// --- Auth ---
export type UserOut = {
  id: number;
  email: string;
  name: string;
  is_verified: boolean;
  role: string;
  created_at: string;
};

export type TokenOut = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

export const api = {
  register: (data: { email: string; name: string; password: string }) =>
    request<{ message: string; detail?: string }>("/auth/register", { method: "POST", body: data, auth: false }),

  verifyOtp: (data: { email: string; code: string }) =>
    request<TokenOut>("/auth/verify-otp", { method: "POST", body: data, auth: false }),

  resendOtp: (email: string) =>
    request<{ message: string }>("/auth/resend-otp", { method: "POST", body: { email }, auth: false }),

  login: (data: { email: string; password: string }) =>
    request<TokenOut>("/auth/login", { method: "POST", body: data, auth: false }),

  logout: () => request<{ message: string }>("/auth/logout", { method: "POST" }),

  logoutAll: () => request<{ message: string }>("/auth/logout-all", { method: "POST" }),

  me: () => request<UserOut>("/auth/me"),

  // --- Media ---
  uploadMedia: (file: File, consent: boolean) => {
    const form = new FormData();
    form.append("file", file);
    form.append("consent", String(consent));
    return request<MediaWithAnalysis>("/media/upload", { method: "POST", form });
  },

  listMedia: (limit = 50, offset = 0) =>
    request<MediaWithAnalysis[]>(`/media/?limit=${limit}&offset=${offset}`),

  getMedia: (id: number) => request<MediaWithAnalysis>(`/media/${id}`),

  deleteMedia: (id: number) => request<void>(`/media/${id}`, { method: "DELETE" }),

  stats: () => request<StatsOut>("/media/stats/summary"),

  fileUrl: (id: number) => {
    const token = readToken();
    return `${API_URL}${API_PREFIX}/media/${id}/file${token ? `?` : ""}`;
  },

  // --- Lab ---
  labStyles: () => request<LabStylesOut>("/lab/styles"),
  labQuota: () => request<{ used: number; remaining: number; limit: number }>("/lab/quota"),
  labTransform: (file: File, style: string) => {
    const form = new FormData();
    form.append("file", file);
    form.append("style", style);
    form.append("consent_own_media", "true");
    form.append("consent_ai_label", "true");
    return request<LabTransformOut>("/lab/transform", { method: "POST", form });
  },

  // --- Lab Advanced ---
  // Voice transformation
  voicePresets: () => request<VoicePresetsOut>("/lab-advanced/voice-presets"),
  transformVoice: (
    file: File,
    preset: string,
    pitchShift: number = 0,
    speed: number = 1.0,
    formantShift: number = 0
  ) => {
    const form = new FormData();
    form.append("file", file);
    form.append("preset", preset);
    form.append("pitch_shift", String(pitchShift));
    form.append("speed", String(speed));
    form.append("formant_shift", String(formantShift));
    return request<AdvancedTransformOut>("/lab-advanced/voice-transform", { method: "POST", form });
  },

  // Video transformation
  videoPresets: () => request<VideoPresetsOut>("/lab-advanced/video-presets"),
  transformVideo: (
    file: File,
    preset: string,
    genderShift: number = 0,
    ageShift: number = 0,
    skinSmoothness: number = 0,
    eyesEnhancement: number = 0,
    brightness: number = 0,
    saturation: number = 0,
    style: string = "original",
    consentOwnMedia: boolean = true,
    consentAiLabel: boolean = true
  ) => {
    const form = new FormData();
    form.append("file", file);
    form.append("preset", preset);
    form.append("gender_shift", String(genderShift));
    form.append("age_shift", String(ageShift));
    form.append("skin_smoothness", String(skinSmoothness));
    form.append("eyes_enhancement", String(eyesEnhancement));
    form.append("brightness", String(brightness));
    form.append("saturation", String(saturation));
    form.append("style", style);
    form.append("consent_own_media", String(consentOwnMedia));
    form.append("consent_ai_label", String(consentAiLabel));
    return request<VideoTransformOut>("/lab-advanced/video-transform", { method: "POST", form });
  },

  // --- Lab Gemini ---
  aiStatus: () => request<AiStatusOut>("/lab-gemini/status", { auth: false }),

  aiQuota: () => request<AiQuotaOut>("/lab-gemini/quota"),

  aiGenerateImage: (prompt: string, aspectRatio: string) =>
    request<AiGenerateImageOut>("/lab-gemini/generate-image", {
      method: "POST",
      body: { prompt, aspect_ratio: aspectRatio },
    }),

  aiTransformImage: (file: File, instruction: string) => {
    const form = new FormData();
    form.append("file", file);
    form.append("instruction", instruction);
    return request<AiGenerateImageOut>("/lab-gemini/transform-image", { method: "POST", form });
  },

  aiGenerateVideo: (prompt: string, durationSeconds: number) =>
    request<AiGenerateVideoOut>("/lab-gemini/generate-video", {
      method: "POST",
      body: { prompt, duration_seconds: durationSeconds },
    }),
};

export type Verdict = "likely_ai" | "likely_real" | "inconclusive";

export type MediaOut = {
  id: number;
  filename: string;
  original_name: string;
  media_type: "image" | "video" | "audio";
  mime_type: string;
  file_size: number;
  status: string;
  created_at: string;
};

export type AnalysisOut = {
  id: number;
  media_id: number;
  verdict: Verdict;
  ai_probability: number;
  confidence: number;
  signals: Record<string, any>;
  reasons: string;
  created_at: string;
};

export type MediaWithAnalysis = {
  media: MediaOut;
  analysis: AnalysisOut | null;
};

export type StatsOut = {
  total_uploads: number;
  total_analyses: number;
  likely_ai: number;
  likely_real: number;
  inconclusive: number;
};

export type LabStylesOut = {
  styles: { id: string; name: string }[];
  daily_quota: number;
  policy: string;
};

export type LabTransformOut = {
  message: string;
  style: string;
  style_name: string;
  download_url: string;
  watermarked: boolean;
  remaining_quota: number;
};

export type VoicePresetsOut = {
  presets: { id: string; name: string; description: string }[];
  reference_datasets?: { name: string; purpose: string; url: string }[];
  recommended_model_path?: string;
  provider_mode?: string;
  configured_models?: Record<string, string | null>;
};

export type VideoPresetsOut = {
  presets: { id: string; name: string; description: string }[];
  disclaimer?: string;
  generation_note?: string;
};

export type AdvancedTransformOut = {
  message: string;
  preset: string;
  download_url: string;
  mime_type?: string;
  audio_base64?: string;
  engine?: string;
  provider_mode?: string;
  model_id?: string | null;
};

export type VideoTransformOut = AdvancedTransformOut & {
  disclaimer: string;
  engine: string;
  mime_type?: string;
  video_base64?: string;
  analysis: {
    ai_probability: number;
    confidence: number;
    verdict: Verdict;
    reasons: string;
  };
};

export type AiStatusOut = {
  configured: boolean;
  model: string;
};

export type AiQuotaOut = {
  used: number;
  remaining: number;
  limit: number;
};

export type AiGenerateImageOut = {
  message: string;
  image_base64: string;
  mime_type: string;
  watermarked: boolean;
  download_url: string;
  remaining_quota: number;
};

export type AiGenerateVideoOut = {
  message: string;
  video_base64: string;
  mime_type: string;
  frames_generated: number;
  duration_seconds: number;
  disclaimer: string;
  download_url: string;
  remaining_quota: number;
};
