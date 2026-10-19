export type PrivacySetting = "everyone" | "contacts" | "nobody";

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  about: string;
  avatarUrl: string | null;
  privacy: {
    lastSeen: PrivacySetting;
    profilePhoto: PrivacySetting;
    about: PrivacySetting;
    readReceipts: boolean;
  };
  createdAt: string;
}

export interface AuthResponse {
  accessToken: string;
  user: UserProfile;
}

export interface SessionInfo {
  id: string;
  deviceName: string;
  createdAt: string;
  lastActiveAt: string;
  current: boolean;
}

export interface DirectoryUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

export interface ChatParticipant extends DirectoryUser {}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  imageData?: string | null;
  audioData?: string | null;
  callStatus?: "completed" | "missed" | "declined" | "cancelled" | null;
  callDurationSeconds?: number | null;
  createdAt: string;
}

export interface ConversationSummary {
  id: string;
  kind: "direct" | "group";
  title: string | null;
  participants: ChatParticipant[];
  lastMessage: ChatMessage | null;
  updatedAt: string;
}
