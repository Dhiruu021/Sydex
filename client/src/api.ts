import type {
  AuthResponse,
  ChatMessage,
  ConversationSummary,
  DirectoryUser,
  SessionInfo,
  UserProfile
} from "@sydex/shared";

const localApiUrl = "http://localhost:4000/api/v1";
const productionApiUrl = "https://sydex-api.onrender.com/api/v1";
const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();
export const apiUrl = import.meta.env.PROD ? productionApiUrl : configuredApiUrl || localApiUrl;
let accessToken: string | null = null;
let refreshInFlight: Promise<AuthResponse> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

async function refreshSession(): Promise<AuthResponse> {
  if (!refreshInFlight) {
    refreshInFlight = fetch(`${apiUrl}/auth/refresh`, { method: "POST", credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Session expired");
        const auth = (await response.json()) as AuthResponse;
        setAccessToken(auth.accessToken);
        return auth;
      })
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers,
    credentials: "include"
  });

  if (response.status === 401 && retry && !["/auth/refresh", "/auth/request-otp", "/auth/verify-otp"].includes(path)) {
    try {
      await refreshSession();
      return request<T>(path, init, false);
    } catch {
      setAccessToken(null);
    }
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  requestOtp: (email: string) => request<{ message: string }>("/auth/request-otp", {
    method: "POST",
    body: JSON.stringify({ email })
  }),
  verifyOtp: (email: string, code: string) => request<AuthResponse>("/auth/verify-otp", {
    method: "POST",
    body: JSON.stringify({ email, code, deviceName: navigator.userAgent.slice(0, 120) || "Web browser" })
  }),
  refresh: refreshSession,
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  logoutAll: () => request<void>("/auth/logout-all", { method: "POST" }),
  deleteAccount: () => request<void>("/auth/account", { method: "DELETE" }),
  getProfile: async () => (await request<{ user: UserProfile }>("/profile")).user,
  updateProfile: async (values: Partial<Omit<UserProfile, "id" | "email" | "createdAt">>) =>
    (await request<{ user: UserProfile }>("/profile", { method: "PATCH", body: JSON.stringify(values) })).user,
  sessions: async () => (await request<{ sessions: SessionInfo[] }>("/auth/sessions")).sessions,
  deleteSession: (id: string) => request<void>(`/auth/sessions/${id}`, { method: "DELETE" }),
  directory: async () => (await request<{ users: DirectoryUser[] }>("/users")).users,
  lookupUserByEmail: async (email: string) =>
    (await request<{ user: DirectoryUser }>(`/users/lookup?email=${encodeURIComponent(email)}`)).user,
  conversations: async () =>
    (await request<{ conversations: ConversationSummary[] }>("/conversations")).conversations,
  startDirectConversation: async (targetUserId: string) =>
    (await request<{ conversation: ConversationSummary }>("/conversations/direct", {
      method: "POST",
      body: JSON.stringify({ userId: targetUserId })
    })).conversation,
  startGroupConversation: async (title: string, participantIds: string[]) =>
    (await request<{ conversation: ConversationSummary }>("/conversations/groups", {
      method: "POST",
      body: JSON.stringify({ title, participantIds })
    })).conversation,
  messages: async (conversationId: string) =>
    (await request<{ messages: ChatMessage[] }>(`/conversations/${conversationId}/messages`)).messages,
  sendMessage: async (conversationId: string, text: string) =>
    (await request<{ message: ChatMessage }>(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ text })
    })).message,
  sendImageMessage: async (conversationId: string, imageData: string) =>
    (await request<{ message: ChatMessage }>(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ imageData })
    })).message,
  sendAudioMessage: async (conversationId: string, audioData: string) =>
    (await request<{ message: ChatMessage }>(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ audioData })
    })).message
};
