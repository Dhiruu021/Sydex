import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Socket } from "socket.io-client";
import type { ChatMessage, ConversationSummary, DirectoryUser, PrivacySetting } from "@sydex/shared";
import { api } from "./api";
import { useAuthStore } from "./store";

function App() {
  const { user, ready, setSession, clearSession, setReady } = useAuthStore();

  useEffect(() => {
    api.refresh()
      .then((session) => setSession(session.accessToken, session.user))
      .catch(() => clearSession())
      .finally(setReady);
  }, [clearSession, setReady, setSession]);

  if (!ready) return <div className="loading">Sydex<span>.</span></div>;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/*" element={user ? <AuthenticatedApp /> : <Navigate to="/login" replace />} />
    </Routes>
  );
}

function AuthenticatedApp() {
  return (
    <Routes>
      <Route path="/" element={<ChatHome />} />
      <Route path="/settings" element={<ProfileHome />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function Login() {
  const navigate = useNavigate();
  const { setSession } = useAuthStore();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const sendCode = useMutation({
    mutationFn: () => api.requestOtp(email),
    onSuccess: ({ message }) => { setNotice(message); setStep("code"); setError(""); },
    onError: (reason: Error) => setError(reason.message)
  });
  const signIn = useMutation({
    mutationFn: () => api.verifyOtp(email, code),
    onSuccess: ({ accessToken, user }) => { setSession(accessToken, user); navigate("/", { replace: true }); },
    onError: (reason: Error) => setError(reason.message)
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (step === "email") sendCode.mutate();
    else signIn.mutate();
  }

  return (
    <main className="login-page antialiased">
      <div className="login-brand"><span className="brand-mark">s</span><span>Sydex</span></div>
      <section className="login-card">
        <div className="eyebrow">A little closer, wherever you are</div>
        <h1>{step === "code" ? "Check your email" : "Welcome to Sydex"}</h1>
        <p className="muted">{step === "email" ? "Enter your email address to get started." : `Enter the 6-digit code sent to ${email}.`}</p>
        <form onSubmit={submit}>
          {step === "email" ? (
            <label className="field">
              <span>Email address</span>
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" required />
            </label>
          ) : (
            <label className="field">
              <span>Verification code</span>
              <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="000000" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required />
              {notice && <small>{notice} In local development, find the code in the API logs.</small>}
            </label>
          )}
          {error && <div className="error-message" role="alert">{error}</div>}
          <button className="primary-button" disabled={sendCode.isPending || signIn.isPending}>
            {step === "code" ? (signIn.isPending ? "Verifying…" : "Verify & sign in") : sendCode.isPending ? "Sending code…" : "Send code to email"}
          </button>
        </form>
        {step === "code" && <button className="text-button" type="button" onClick={() => { setStep("email"); setCode(""); setError(""); }}>Use a different email</button>}
        <div className="secure-note"><span>◈</span> Your messages are private and secure.</div>
      </section>
      <footer>Independent communication, made for you.</footer>
    </main>
  );
}

function ChatHome() {
  const { user } = useAuthStore();
  const client = useQueryClient();
  const [activeId, setActiveId] = useState("");
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [conversationFilter, setConversationFilter] = useState<"all" | "groups" | "favorites">("all");
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => readFavoriteIds(user?.id ?? ""));
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [mobileChatMenuOpen, setMobileChatMenuOpen] = useState(false);
  const [cameraPreview, setCameraPreview] = useState<{ url: string; file: File } | null>(null);
  const [cameraRecipientId, setCameraRecipientId] = useState("");
  const [cameraSending, setCameraSending] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [cameraConversationId, setCameraConversationId] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [voiceDraft, setVoiceDraft] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localCallStreamRef = useRef<MediaStream | null>(null);
  const remoteCallStreamRef = useRef<MediaStream | null>(null);
  const queuedIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const callPeerIdRef = useRef("");
  const callConversationIdRef = useRef("");
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const [callStatus, setCallStatus] = useState<"idle" | "calling" | "incoming" | "connected">("idle");
  const [incomingCall, setIncomingCall] = useState<{ conversationId: string; callerUserId: string; callerName: string; callerEmail: string; offer: RTCSessionDescriptionInit } | null>(null);
  const [callPeerName, setCallPeerName] = useState("");
  const [callError, setCallError] = useState("");
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [messageSearchQuery, setMessageSearchQuery] = useState("");
  const [chatMenuOpen, setChatMenuOpen] = useState(false);
  const [contactInfoOpen, setContactInfoOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupTitle, setGroupTitle] = useState("");
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [socketStatus, setSocketStatus] = useState("Connecting");
  const [socketError, setSocketError] = useState("");
  const [actionError, setActionError] = useState("");
  const conversations = useQuery({ queryKey: ["conversations"], queryFn: api.conversations });
  const directory = useQuery({ queryKey: ["directory"], queryFn: api.directory });
  const messages = useQuery({
    queryKey: ["messages", activeId],
    queryFn: () => api.messages(activeId),
    enabled: Boolean(activeId)
  });

  useEffect(() => {
    let disposed = false;
    let disconnect: (() => void) | undefined;
    void import("./chatSocket").then(({ connectChatSocket }) => {
      if (disposed) return;
      const socket = connectChatSocket();
      socketRef.current = socket;
      disconnect = () => { socketRef.current = null; socket.disconnect(); };
      const updateMessages = (event: { conversationId: string; message: ChatMessage }) => {
        client.setQueryData<ChatMessage[]>(["messages", event.conversationId], (current) => {
          if (!current || current.some((message) => message.id === event.message.id)) return current;
          return [...current, event.message];
        });
        void client.invalidateQueries({ queryKey: ["conversations"] });
      };
      socket.on("connect", () => { setSocketStatus("Live"); setSocketError(""); });
      socket.on("disconnect", () => setSocketStatus("Reconnecting"));
      socket.on("connect_error", (error: Error) => {
        setSocketStatus("Offline");
        setSocketError(error.message);
      });
      socket.on("chat:message", updateMessages);
      socket.on("chat:conversation", () => { void client.invalidateQueries({ queryKey: ["conversations"] }); });
      socket.on("chat:messages-deleted", (event: { conversationId: string }) => {
        void client.invalidateQueries({ queryKey: ["messages", event.conversationId] });
        void client.invalidateQueries({ queryKey: ["conversations"] });
      });
      socket.on("chat:conversation-deleted", (event: { conversationId: string }) => {
        client.removeQueries({ queryKey: ["messages", event.conversationId] });
        void client.invalidateQueries({ queryKey: ["conversations"] });
      });
      socket.on("call:incoming", (event: { conversationId: string; callerUserId: string; callerName: string; callerEmail: string; offer: RTCSessionDescriptionInit }) => {
        setIncomingCall(event);
        setCallPeerName(event.callerName);
        setCallError("");
        callPeerIdRef.current = event.callerUserId;
        callConversationIdRef.current = event.conversationId;
        setCallStatus("incoming");
        setActiveId(event.conversationId);
        setMobileChatOpen(true);
        setDirectoryOpen(false);
      });
      socket.on("call:accepted", async (event: { conversationId: string; callerUserId: string; signal: { answer: RTCSessionDescriptionInit } }) => {
        const peer = peerConnectionRef.current;
        if (event.conversationId !== callConversationIdRef.current || event.callerUserId !== callPeerIdRef.current || !peer) return;
        try {
          await peer.setRemoteDescription(new RTCSessionDescription(event.signal.answer));
          setCallStatus("connected");
          for (const candidate of queuedIceCandidatesRef.current.splice(0)) await peer.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error) {
          setCallError(error instanceof Error ? error.message : "Could not connect the call.");
        }
      });
      socket.on("call:ice", async (event: { conversationId: string; callerUserId: string; signal: { candidate: RTCIceCandidateInit } }) => {
        if (event.conversationId !== callConversationIdRef.current) return;
        try {
          const peer = peerConnectionRef.current;
          if (peer?.remoteDescription) await peer.addIceCandidate(new RTCIceCandidate(event.signal.candidate));
          else queuedIceCandidatesRef.current.push(event.signal.candidate);
        } catch (error) {
          setCallError(error instanceof Error ? error.message : "Could not connect call audio.");
        }
      });
      socket.on("call:ended", (event: { conversationId: string; callerUserId: string }) => {
        if (event.conversationId === callConversationIdRef.current && event.callerUserId === callPeerIdRef.current) finishCall(false);
      });
    }).catch((error: unknown) => {
      setSocketStatus("Offline");
      setSocketError(error instanceof Error ? error.message : "Could not load live chat.");
    });
    return () => {
      disposed = true;
      disconnect?.();
    };
  }, [client]);

  useEffect(() => {
    if (!activeId && conversations.data?.length) setActiveId(conversations.data[0].id);
    if (activeId && conversations.data && !conversations.data.some((item) => item.id === activeId)) {
      setActiveId(conversations.data[0]?.id ?? "");
    }
  }, [activeId, conversations.data]);

  useEffect(() => {
    try {
      localStorage.setItem(`sydex:favorites:${user?.id ?? ""}`, JSON.stringify(favoriteIds));
    } catch (error) {
      console.warn("Could not save chat favorites.", error);
    }
  }, [favoriteIds, user?.id]);

  const activeConversation = conversations.data?.find((item) => item.id === activeId);
  const visibleMessages = (messages.data ?? []).filter((message) => !messageSearchQuery || `${message.text} ${message.senderId === user?.id ? "You" : activeConversation?.participants.find((person) => person.id === message.senderId)?.name ?? ""}`.toLowerCase().includes(messageSearchQuery.toLowerCase()));
  const matchingConversations = (conversations.data ?? []).filter((item) => {
    const title = conversationTitle(item, user?.id ?? "");
    const matchesSearch = `${title} ${item.lastMessage?.text ?? ""}`.toLowerCase().includes(filter.toLowerCase());
    const matchesCategory = conversationFilter === "all"
      || (conversationFilter === "groups" && item.kind === "group")
      || (conversationFilter === "favorites" && favoriteIds.includes(item.id));
    return matchesSearch && matchesCategory;
  });
  const matchingUsers = (directory.data ?? []).filter((person) =>
    `${person.name} ${person.email}`.toLowerCase().includes(filter.toLowerCase())
  );
  function rememberConversation(conversation: ConversationSummary) {
    client.setQueryData<ConversationSummary[]>(["conversations"], (current) => [
      conversation,
      ...(current ?? []).filter((item) => item.id !== conversation.id)
    ]);
  }
  const startDirect = useMutation({
    mutationFn: api.startDirectConversation,
    onSuccess: (conversation) => {
      rememberConversation(conversation);
      setActiveId(conversation.id);
      setMobileChatOpen(true);
      setDirectoryOpen(false);
      setActionError("");
      void client.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (error: Error) => setActionError(error.message)
  });
  const lookupUser = useMutation({
    mutationFn: (email: string) => api.lookupUserByEmail(email.trim().toLowerCase()),
    onSuccess: (person) => {
      setActionError("");
      setFilter("");
      startDirect.mutate(person.id);
    },
    onError: (error: Error) => setActionError(error.message)
  });
  const createGroup = useMutation({
    mutationFn: () => api.startGroupConversation(groupTitle, groupMembers),
    onSuccess: (conversation) => {
      rememberConversation(conversation);
      setActiveId(conversation.id);
      setMobileChatOpen(true);
      setGroupOpen(false);
      setGroupTitle("");
      setGroupMembers([]);
      setActionError("");
      void client.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (error: Error) => setActionError(error.message)
  });
  const sendMessage = useMutation({
    mutationFn: () => api.sendMessage(activeId, draft),
    onSuccess: (message) => {
      client.setQueryData<ChatMessage[]>(["messages", activeId], (current) =>
        current?.some((item) => item.id === message.id) ? current : [...(current ?? []), message]
      );
      setDraft("");
      setActionError("");
      void client.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (error: Error) => setActionError(error.message)
  });

  function submitMessage(event: FormEvent) {
    event.preventDefault();
    if (draft.trim() && activeId) sendMessage.mutate();
  }

  function createCallPeerConnection(stream: MediaStream, conversationId: string, targetUserId: string): RTCPeerConnection {
    const peer = new RTCPeerConnection({ iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" }
    ] });
    peerConnectionRef.current = peer;
    stream.getTracks().forEach((track) => peer.addTrack(track, stream));
    peer.onicecandidate = (event) => {
      if (event.candidate) socketRef.current?.emit("call:ice", { conversationId, targetUserId, candidate: event.candidate.toJSON() });
    };
    peer.ontrack = (event) => {
      remoteCallStreamRef.current = event.streams[0] ?? new MediaStream([event.track]);
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = remoteCallStreamRef.current;
      void remoteAudioRef.current?.play().catch(() => undefined);
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "failed") setCallError("The call could not connect. Check your network and try again.");
    };
    return peer;
  }

  async function startVoiceCall() {
    if (!activeConversation || activeConversation.kind !== "direct") return;
    const target = activeConversation.participants.find((person) => person.id !== user?.id);
    if (!target) return;
    if (!socketRef.current?.connected) {
      setCallError("Call service is offline. Try again in a moment.");
      return;
    }
    try {
      setCallError("");
      setCallPeerName(target.name || target.email);
      callPeerIdRef.current = target.id;
      callConversationIdRef.current = activeConversation.id;
      setCallStatus("calling");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localCallStreamRef.current = stream;
      const peer = createCallPeerConnection(stream, activeConversation.id, target.id);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      socketRef.current.emit("call:invite", { conversationId: activeConversation.id, targetUserId: target.id, offer: peer.localDescription });
    } catch (error) {
      setCallError(error instanceof Error ? error.message : "Could not start the call. Allow microphone access and try again.");
      finishCall(false);
    }
  }

  async function acceptVoiceCall() {
    if (!incomingCall || !socketRef.current?.connected) return;
    try {
      setCallError("");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localCallStreamRef.current = stream;
      const peer = createCallPeerConnection(stream, incomingCall.conversationId, incomingCall.callerUserId);
      await peer.setRemoteDescription(new RTCSessionDescription(incomingCall.offer));
      for (const candidate of queuedIceCandidatesRef.current.splice(0)) await peer.addIceCandidate(new RTCIceCandidate(candidate));
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      socketRef.current.emit("call:accept", { conversationId: incomingCall.conversationId, targetUserId: incomingCall.callerUserId, answer: peer.localDescription });
      setCallStatus("connected");
      setIncomingCall(null);
    } catch (error) {
      setCallError(error instanceof Error ? error.message : "Could not answer the call. Allow microphone access and try again.");
      finishCall(true);
    }
  }

  function finishCall(notifyPeer = true) {
    if (notifyPeer && callPeerIdRef.current && callConversationIdRef.current) {
      socketRef.current?.emit("call:end", { conversationId: callConversationIdRef.current, targetUserId: callPeerIdRef.current });
    }
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    localCallStreamRef.current?.getTracks().forEach((track) => track.stop());
    localCallStreamRef.current = null;
    remoteCallStreamRef.current = null;
    queuedIceCandidatesRef.current = [];
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    callPeerIdRef.current = "";
    callConversationIdRef.current = "";
    setIncomingCall(null);
    setCallStatus("idle");
  }

  async function sendCameraPhoto() {
    if (!cameraPreview || (!cameraConversationId && !cameraRecipientId)) return;
    setCameraSending(true);
    setCameraError("");
    try {
      const imageData = await compressChatImage(cameraPreview.file);
      const conversation = cameraConversationId
        ? (conversations.data ?? []).find((item) => item.id === cameraConversationId)
        : (conversations.data ?? []).find((item) => item.kind === "direct" && item.participants.some((person) => person.id === cameraRecipientId))
          ?? await api.startDirectConversation(cameraRecipientId);
      if (!conversation) throw new Error("Could not find this conversation.");
      rememberConversation(conversation);
      const message = await api.sendImageMessage(conversation.id, imageData);
      client.setQueryData<ChatMessage[]>(["messages", conversation.id], (current) => [
        ...(current ?? []).filter((item) => item.id !== message.id), message
      ]);
      setActiveId(conversation.id);
      setMobileChatOpen(true);
      setDirectoryOpen(false);
      setCameraPreview(null);
      setCameraConversationId("");
      void client.invalidateQueries({ queryKey: ["conversations"] });
    } catch (error) {
      setCameraError(error instanceof Error ? error.message : "Could not send this photo.");
    } finally {
      setCameraSending(false);
    }
  }

  async function toggleVoiceRecording() {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
      return;
    }
    try {
      setVoiceError("");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        stream.getTracks().forEach((track) => track.stop());
        recorderRef.current = null;
        setVoiceRecording(false);
        if (blob.size > 900_000) {
          setVoiceError("Voice note is too long to send. Keep it under one minute.");
          return;
        }
        void blobToDataUrl(blob).then(setVoiceDraft).catch(() => setVoiceError("Could not prepare the voice note."));
      };
      recorder.start();
      recorderRef.current = recorder;
      setVoiceRecording(true);
      window.setTimeout(() => { if (recorder.state === "recording") recorder.stop(); }, 60_000);
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : "Microphone access was not available.");
    }
  }

  async function sendVoiceMessage() {
    if (!voiceDraft || !activeId) return;
    setVoiceError("");
    try {
      const message = await api.sendAudioMessage(activeId, voiceDraft);
      client.setQueryData<ChatMessage[]>(["messages", activeId], (current) => [...(current ?? []), message]);
      setVoiceDraft(null);
      void client.invalidateQueries({ queryKey: ["conversations"] });
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : "Could not send the voice note.");
    }
  }

  function insertEmoji(emoji: string) {
    setDraft((current) => `${current}${emoji}`);
    setEmojiOpen(false);
  }

  const emailSearchReady = directoryOpen && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(filter.trim());
  useEffect(() => () => { if (cameraPreview) URL.revokeObjectURL(cameraPreview.url); }, [cameraPreview]);
  return (
    <main className={`app-shell chat-shell ${mobileChatOpen ? "mobile-chat-open" : ""}`}>
      <aside className="rail">
        <div className="rail-logo">s</div>
        <div className="rail-actions">
          <Link className={`rail-action ${directoryOpen ? "" : "active"}`} to="/" title="Chats" aria-label="Chats" onClick={() => setDirectoryOpen(false)}>▤</Link>
          <button className={`rail-action ${directoryOpen ? "active" : ""}`} type="button" title="People" aria-label="People" aria-pressed={directoryOpen} onClick={() => { setDirectoryOpen(true); setFilter(""); }}>♙</button>
          <Link className="rail-action" to="/settings" title="Settings" aria-label="Settings">⚙</Link>
        </div>
        <Link className="rail-avatar" to="/settings" title="Your profile">{initials(user?.name || user?.email || "S")}</Link>
      </aside>
      <section className="chat-workspace">
        <aside className="chat-sidebar">
          <header className="chat-sidebar-header">
            <div><span className="eyebrow">SYDEX</span><h1>{directoryOpen ? "People" : "Chats"}</h1></div>
            <div className="chat-header-actions">
              <button className="new-group-button" type="button" onClick={() => { setGroupOpen(true); setActionError(""); }} title="Create group" aria-label="Create group">＋</button>
              <label className="mobile-camera-button" aria-label="Open camera or choose photo" title="Camera">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5h3l1.5-2h7l1.5 2h3A1.5 1.5 0 0 1 21.5 9v9A1.5 1.5 0 0 1 20 19.5H4A1.5 1.5 0 0 1 2.5 18V9A1.5 1.5 0 0 1 4 7.5Z"/><circle cx="12" cy="13.5" r="4"/></svg>
                <input type="file" accept="image/*" capture="environment" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) { setCameraError(""); setCameraConversationId(""); setCameraRecipientId(""); setCameraPreview({ url: URL.createObjectURL(file), file }); } }} />
              </label>
              <div className="mobile-chat-menu">
                <button type="button" className="mobile-chat-menu-trigger" aria-label="More options" aria-haspopup="menu" aria-expanded={mobileChatMenuOpen} onClick={() => setMobileChatMenuOpen((open) => !open)}>⋮</button>
                {mobileChatMenuOpen && <><button type="button" className="mobile-chat-menu-dismiss" aria-label="Close menu" onClick={() => setMobileChatMenuOpen(false)} /><div className="mobile-chat-menu-popover" role="menu">
                  <button type="button" role="menuitem" onClick={() => { setDirectoryOpen(!directoryOpen); setFilter(""); setMobileChatMenuOpen(false); }}>{directoryOpen ? "Chats" : "People"}</button>
                  <button type="button" role="menuitem" onClick={() => { setGroupOpen(true); setActionError(""); setMobileChatMenuOpen(false); }}>New group</button>
                  <Link role="menuitem" to="/settings" onClick={() => setMobileChatMenuOpen(false)}>Settings</Link>
                </div></>}
              </div>
            </div>
          </header>
          <form className="chat-search" onSubmit={(event) => { event.preventDefault(); if (emailSearchReady) { setActionError(""); lookupUser.mutate(filter); } }}>
            <span aria-hidden="true">⌕</span>
            <input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={directoryOpen ? "Search people or enter an email" : "Search or start a chat"} />
            {emailSearchReady && <button className="email-search-submit" type="submit" disabled={lookupUser.isPending || startDirect.isPending}>{lookupUser.isPending ? "Searching…" : "Chat"}</button>}
          </form>
          {!directoryOpen && (
            <div className="chat-filters" role="group" aria-label="Filter chats">
              <button type="button" className={conversationFilter === "all" ? "active" : ""} aria-pressed={conversationFilter === "all"} onClick={() => setConversationFilter("all")}>All</button>
              <button type="button" className={conversationFilter === "groups" ? "active" : ""} aria-pressed={conversationFilter === "groups"} onClick={() => setConversationFilter("groups")}>Groups</button>
              <button type="button" className={conversationFilter === "favorites" ? "active" : ""} aria-pressed={conversationFilter === "favorites"} onClick={() => setConversationFilter("favorites")}>Favourites</button>
            </div>
          )}
          {!directoryOpen && <button className="directory-toggle" type="button" onClick={() => { setDirectoryOpen(true); setFilter(""); }}>
            +  Start a conversation
          </button>}
          {directoryOpen && actionError && <p className="directory-lookup-error" role="alert">{actionError}</p>}
          <div className="conversation-list">
            {directoryOpen ? (
              directory.isLoading ? <p className="chat-empty-small">Loading people…</p>
                : directory.isError ? <p className="error-message">Could not load people.</p>
                  : matchingUsers.map((person) => (
                    <button className="conversation-item" type="button" key={person.id} onClick={() => startDirect.mutate(person.id)}>
                      <PersonAvatar person={person} />
                      <span className="conversation-copy"><strong>{person.name || person.email}</strong><small>{person.email}</small></span>
                    </button>
                  ))
            ) : conversations.isLoading ? <p className="chat-empty-small">Loading your chats…</p>
              : conversations.isError ? <p className="error-message">Could not load your chats.</p>
                : matchingConversations.map((conversation) => (
                  <div className="conversation-row" key={conversation.id}>
                    <button className={`conversation-item ${activeId === conversation.id ? "selected" : ""}`} type="button" onClick={() => { setActiveId(conversation.id); setMobileChatOpen(true); }}>
                      <ConversationAvatar conversation={conversation} currentUserId={user?.id ?? ""} />
                      <span className="conversation-copy">
                        <strong>{conversationTitle(conversation, user?.id ?? "")}</strong>
                        <small>{conversation.lastMessage?.text ?? "Start chatting"}</small>
                      </span>
                      {conversation.lastMessage && <time>{formatTime(conversation.lastMessage.createdAt)}</time>}
                    </button>
                    <button
                      className={`favorite-toggle ${favoriteIds.includes(conversation.id) ? "is-favorite" : ""}`}
                      type="button"
                      aria-label={`${favoriteIds.includes(conversation.id) ? "Remove from" : "Add to"} favourites: ${conversationTitle(conversation, user?.id ?? "")}`}
                      aria-pressed={favoriteIds.includes(conversation.id)}
                      onClick={() => setFavoriteIds((current) => current.includes(conversation.id)
                        ? current.filter((id) => id !== conversation.id)
                        : [...current, conversation.id])}
                    >
                      {favoriteIds.includes(conversation.id) ? "★" : "☆"}
                    </button>
                  </div>
                ))
            }
            {!directoryOpen && !conversations.isLoading && !conversations.isError && matchingConversations.length === 0 &&
              <p className="chat-empty-small">{conversationFilter === "favorites" ? "No favourites yet. Star a chat to keep it here." : conversationFilter === "groups" ? "No group chats yet. Create a group to bring people together." : "No chats yet. Start a conversation with someone."}</p>}
            {directoryOpen && !directory.isLoading && !directory.isError && matchingUsers.length === 0 &&
              <p className="chat-empty-small">No people found.</p>}
          </div>
          <div className="chat-sidebar-footer"><span className={`status-dot ${socketStatus === "Live" ? "" : "status-muted"}`} />{socketStatus}</div>
        </aside>

        <section className="chat-panel">
          {activeConversation ? (
            <>
              <header className="conversation-header">
                <button className="mobile-back" type="button" onClick={() => setMobileChatOpen(false)} aria-label="Back to chats">‹</button>
                <ConversationAvatar conversation={activeConversation} currentUserId={user?.id ?? ""} />
                <div className="conversation-identity"><strong>{conversationTitle(activeConversation, user?.id ?? "")}</strong><small>{activeConversation.kind === "group" ? `${activeConversation.participants.length} members` : activeConversation.participants.find((person) => person.id !== user?.id)?.email}</small></div>
                <div className="conversation-actions">
                  {activeConversation.kind === "direct" && <button className="conversation-action" type="button" onClick={() => void startVoiceCall()} aria-label="Start voice call" title="Start voice call">☎</button>}
                  <button className="conversation-action" type="button" aria-label="Search messages" title="Search messages" onClick={() => { setChatSearchOpen((open) => !open); setMessageSearchQuery(""); }}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.3"/><path d="m16 16 4.5 4.5"/></svg></button>
                  <div className="conversation-more">
                    <button className="conversation-action more-trigger" type="button" aria-label="Conversation options" aria-expanded={chatMenuOpen} onClick={() => setChatMenuOpen((open) => !open)}>⋮</button>
                    {chatMenuOpen && <><button className="conversation-menu-dismiss" type="button" aria-label="Close options" onClick={() => setChatMenuOpen(false)} /><div className="conversation-menu-popover" role="menu">
                      <button type="button" role="menuitem" onClick={() => { setContactInfoOpen(true); setChatMenuOpen(false); }}>Contact info</button>
                      <button type="button" role="menuitem" onClick={() => { setChatSearchOpen(true); setChatMenuOpen(false); }}>Search messages</button>
                    </div></>}
                  </div>
                </div>
              </header>
              {chatSearchOpen && <div className="message-search-bar"><input autoFocus value={messageSearchQuery} onChange={(event) => setMessageSearchQuery(event.target.value)} placeholder="Search in conversation" aria-label="Search in conversation" /><button type="button" onClick={() => { setMessageSearchQuery(""); setChatSearchOpen(false); }}>Close</button></div>}
              <div className="message-list">
                {messages.isLoading ? <p className="chat-empty-small">Loading messages…</p>
                  : messages.isError ? <p className="error-message">Could not load messages.</p>
                    : visibleMessages.length ? visibleMessages.map((message) => (
                      <div className={`message-row ${message.senderId === user?.id ? "mine" : ""}`} key={message.id}>
                        <div className="message-bubble">
                          {activeConversation.kind === "group" && message.senderId !== user?.id &&
                            <strong className="message-sender">{activeConversation.participants.find((person) => person.id === message.senderId)?.name || "Member"}</strong>}
                          {message.imageData && <img className="message-image" src={message.imageData} alt="Photo message" />}
                          {message.audioData && <audio className="message-audio" controls preload="metadata" src={message.audioData} />}
                          {message.callStatus && <div className={`call-history ${message.callStatus}`}><span className="call-history-icon" aria-hidden="true">{message.callStatus === "completed" ? "↗" : "↙"}</span><span><strong>{message.callStatus === "completed" ? "Voice call" : message.callStatus === "missed" ? "Missed call" : message.callStatus === "declined" ? "Declined call" : "Cancelled call"}</strong>{message.callStatus === "completed" && <small>{formatCallDuration(message.callDurationSeconds ?? 0)}</small>}</span></div>}
                          {message.text && !message.callStatus && <p>{message.text}</p>}<time>{formatTime(message.createdAt)}</time>
                        </div>
                      </div>
                    )) : messages.data?.length ? <p className="chat-empty-small message-search-empty">No matching messages.</p> : <div className="chat-welcome"><span className="welcome-mark">s</span><h2>Say hello</h2><p>Your conversation starts here.</p></div>}
              </div>
              {actionError && !directoryOpen && !groupOpen && <p className="chat-action-error" role="alert">{actionError}</p>}
              {socketError && <p className="chat-action-error" role="status">Live updates unavailable: {socketError}</p>}
              {callError && callStatus === "idle" && <p className="chat-action-error" role="alert">{callError}</p>}
              {voiceError && <p className="chat-action-error" role="alert">{voiceError}</p>}
              {voiceRecording && <div className="voice-recording-state"><span /> Recording voice note… tap the microphone to stop</div>}
              {voiceDraft && <div className="voice-draft"><audio controls src={voiceDraft} /><button type="button" className="secondary-button" onClick={() => setVoiceDraft(null)}>Discard</button><button type="button" className="primary-button" onClick={() => void sendVoiceMessage()}>Send voice note</button></div>}
              <form className="message-composer" onSubmit={submitMessage}>
                {emojiOpen && <div className="emoji-picker">{["😀", "😂", "🥰", "😍", "😊", "👍", "❤️", "🎉", "🙏", "😢", "🔥", "👏"].map((emoji) => <button type="button" key={emoji} onClick={() => insertEmoji(emoji)}>{emoji}</button>)}</div>}
                <div className="composer-pill">
                  <button className="composer-icon-button emoji-trigger" type="button" aria-label="Emoji" title="Emoji" onClick={() => setEmojiOpen((open) => !open)}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.2s1.2 2 3.5 2 3.5-2 3.5-2"/><path d="M9 9.5h.01M15 9.5h.01"/></svg></button>
                  <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Message" maxLength={4000} aria-label="Message" />
                  <label className="composer-icon-button attach-photo-button" aria-label="Attach photo" title="Attach photo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 12.5 14.5 6a4 4 0 0 1 5.7 5.7l-8.8 8.8a6 6 0 0 1-8.5-8.5l9.2-9.2"/><path d="m7.2 14.4 8.5-8.5"/></svg><input type="file" accept="image/*" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) { setCameraConversationId(activeConversation.id); setCameraRecipientId(""); setCameraError(""); setCameraPreview({ url: URL.createObjectURL(file), file }); } }} /></label>
                  <label className="composer-icon-button mobile-composer-camera" aria-label="Take photo" title="Take photo">📷<input type="file" accept="image/*" capture="environment" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) { setCameraConversationId(activeConversation.id); setCameraRecipientId(""); setCameraError(""); setCameraPreview({ url: URL.createObjectURL(file), file }); } }} /></label>
                </div>
                {draft.trim() ? <button className="primary-button composer-send-button" aria-label="Send message" disabled={sendMessage.isPending}>{sendMessage.isPending ? "…" : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 18-8-7.5 18-2.8-7.7L3 11Z"/><path d="m10.7 13.3 5-5"/></svg>}</button> : <button className={`composer-icon-button microphone-button ${voiceRecording ? "recording" : ""}`} type="button" aria-label={voiceRecording ? "Stop recording" : "Record voice note"} title={voiceRecording ? "Stop recording" : "Record voice note"} onClick={() => void toggleVoiceRecording()}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3m-4 0h8"/></svg></button>}
              </form>
            </>
          ) : (
            <div className="chat-welcome">
                <span className="welcome-mark">s</span><h2>Your conversations, all in one place</h2>
                <p>Choose a chat from the list, find someone new, or start a group conversation.</p>
                <div className="welcome-actions">
                  <button className="primary-button" type="button" onClick={() => { setDirectoryOpen(true); setFilter(""); }}>Find people</button>
                  <button className="secondary-button" type="button" onClick={() => { setGroupOpen(true); setActionError(""); }}>Create a group</button>
                </div>
            </div>
          )}
        </section>
      </section>
      {callStatus !== "idle" && <div className="call-backdrop"><section className="call-dialog" role="dialog" aria-modal="true" aria-label="Voice call"><div className="call-avatar">{initials(callPeerName || "S")}</div><h2>{incomingCall ? incomingCall.callerName : callPeerName}</h2><p>{callStatus === "incoming" ? "Incoming voice call" : callStatus === "calling" ? "Calling…" : "Voice call connected"}</p><audio ref={remoteAudioRef} autoPlay playsInline />{callError && <p className="call-error" role="alert">{callError}</p>}<div className="call-actions">{callStatus === "incoming" ? <><button type="button" className="call-decline" onClick={() => finishCall(true)}>Decline</button><button type="button" className="call-accept" onClick={() => void acceptVoiceCall()}>Answer</button></> : <button type="button" className="call-decline" onClick={() => finishCall(true)}>End call</button>}</div></section></div>}
      {groupOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setGroupOpen(false); }}>
          <form className="group-modal" onSubmit={(event) => { event.preventDefault(); createGroup.mutate(); }}>
            <div className="panel-heading"><div><h2>Create a group</h2><p>Choose a name and at least two people.</p></div><button type="button" className="modal-close" onClick={() => setGroupOpen(false)} aria-label="Close">×</button></div>
            <label className="field"><span>Group name</span><input value={groupTitle} onChange={(event) => setGroupTitle(event.target.value)} maxLength={80} required /></label>
            <div className="group-member-list">
              {directory.data?.map((person) => (
                <label className="group-member" key={person.id}>
                  <input type="checkbox" checked={groupMembers.includes(person.id)} onChange={(event) => setGroupMembers(event.target.checked ? [...groupMembers, person.id] : groupMembers.filter((id) => id !== person.id))} />
                  <PersonAvatar person={person} /><span><strong>{person.name || person.email}</strong><small>{person.email}</small></span>
                </label>
              ))}
              {!directory.isLoading && !directory.isError && !directory.data?.length && <p className="chat-empty-small">No other users are registered yet.</p>}
              {directory.isLoading && <p className="chat-empty-small">Loading people…</p>}
              {directory.isError && <p className="error-message">Could not load people.</p>}
            </div>
            {actionError && <p className="error-message" role="alert">{actionError}</p>}
            <button className="primary-button group-create-button" disabled={createGroup.isPending || groupMembers.length < 2 || !groupTitle.trim()}>{createGroup.isPending ? "Creating…" : `Create group (${groupMembers.length} selected)`}</button>
          </form>
        </div>
      )}
      {contactInfoOpen && activeConversation && <div className="camera-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setContactInfoOpen(false); }}><section className="contact-info-dialog" role="dialog" aria-modal="true" aria-label="Contact information"><div className="contact-info-heading"><h2>{activeConversation.kind === "group" ? activeConversation.title || "Group" : "Contact info"}</h2><button type="button" aria-label="Close" onClick={() => setContactInfoOpen(false)}>×</button></div>{activeConversation.kind === "direct" ? activeConversation.participants.filter((person) => person.id !== user?.id).map((person) => <div className="contact-info-person" key={person.id}><PersonAvatar person={person} /><div><strong>{person.name || person.email}</strong><span>{person.email}</span></div></div>) : <div className="contact-info-members">{activeConversation.participants.map((person) => <div className="contact-info-person" key={person.id}><PersonAvatar person={person} /><div><strong>{person.name || person.email}</strong><span>{person.email}</span></div></div>)}</div>}<button type="button" className="secondary-button" onClick={() => setContactInfoOpen(false)}>Done</button></section></div>}
      {cameraPreview && <div className="camera-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !cameraSending) setCameraPreview(null); }}><section className="camera-preview-dialog" role="dialog" aria-modal="true" aria-label="Send photo"><h2>Send photo</h2><img src={cameraPreview.url} alt="Selected photo preview" />{!cameraConversationId && <label className="field"><span>Choose recipient</span><select value={cameraRecipientId} onChange={(event) => setCameraRecipientId(event.target.value)}><option value="">Select someone</option>{directory.data?.map((person) => <option key={person.id} value={person.id}>{person.name || person.email} · {person.email}</option>)}</select></label>}{cameraError && <p className="error-message" role="alert">{cameraError}</p>}<div className="camera-preview-actions"><button type="button" className="secondary-button" disabled={cameraSending} onClick={() => setCameraPreview(null)}>Cancel</button><button type="button" className="primary-button" disabled={(!cameraConversationId && !cameraRecipientId) || cameraSending} onClick={() => void sendCameraPhoto()}>{cameraSending ? "Sending…" : "Send photo"}</button></div></section></div>}
      {!mobileChatOpen && (
        <nav className="mobile-nav" aria-label="Main navigation">
          <Link className={!directoryOpen ? "active" : ""} to="/" onClick={() => { setDirectoryOpen(false); setFilter(""); }}>
            <span className="mobile-nav-icon" aria-hidden="true">▤</span><span>Chats</span>
          </Link>
          <button className={directoryOpen ? "active" : ""} type="button" aria-current={directoryOpen ? "page" : undefined} onClick={() => { setDirectoryOpen(true); setFilter(""); }}>
            <span className="mobile-nav-icon" aria-hidden="true">♙</span><span>People</span>
          </button>
          <Link to="/settings">
            <span className="mobile-nav-icon" aria-hidden="true">⚙</span><span>Settings</span>
          </Link>
        </nav>
      )}
    </main>
  );
}

function PersonAvatar({ person }: { person: DirectoryUser }) {
  return person.avatarUrl
    ? <img className="chat-avatar" src={person.avatarUrl} alt="" />
      : <span className="chat-avatar avatar-fallback">{initials(person.name || person.email)}</span>;
}

function ConversationAvatar({ conversation, currentUserId }: { conversation: ConversationSummary; currentUserId: string }) {
  const person = conversation.participants.find((item) => item.id !== currentUserId) ?? conversation.participants[0];
  return person ? <PersonAvatar person={person} /> : <span className="chat-avatar avatar-fallback">S</span>;
}

function conversationTitle(conversation: ConversationSummary, currentUserId: string): string {
  if (conversation.kind === "group") return conversation.title || "Group chat";
  const person = conversation.participants.find((item) => item.id !== currentUserId);
    return person?.name || person?.email || "Conversation";
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatCallDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function ProfileHome() {
  const { user, setUser, clearSession } = useAuthStore();
  const client = useQueryClient();
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({
    name: user?.name ?? "",
    about: user?.about ?? "",
    avatarUrl: user?.avatarUrl ?? "",
    lastSeen: user?.privacy.lastSeen ?? "everyone" as PrivacySetting,
    profilePhoto: user?.privacy.profilePhoto ?? "everyone" as PrivacySetting,
    aboutPrivacy: user?.privacy.about ?? "everyone" as PrivacySetting,
    readReceipts: user?.privacy.readReceipts ?? true
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [photoError, setPhotoError] = useState("");

  const sessions = useQuery({ queryKey: ["sessions"], queryFn: api.sessions });
  const update = useMutation({
    mutationFn: () => api.updateProfile({
      name: form.name,
      about: form.about,
      avatarUrl: form.avatarUrl || null,
      privacy: {
        lastSeen: form.lastSeen,
        profilePhoto: form.profilePhoto,
        about: form.aboutPrivacy,
        readReceipts: form.readReceipts
      }
    }),
    onSuccess: (nextUser) => { setUser(nextUser); setSaved(true); window.setTimeout(() => setSaved(false), 2500); }
  });
  const deleteAccount = useMutation({
    mutationFn: api.deleteAccount,
    onSuccess: async () => {
      clearSession();
      await client.clear();
    }
  });

  function confirmDeleteAccount() {
    setMobileMenuOpen(false);
    if (window.confirm("Permanently delete your account, direct chats, and your messages in groups? This cannot be undone.")) {
      deleteAccount.mutate();
    }
  }

  async function logout(all = false) {
    try {
      if (all) await api.logoutAll();
      else await api.logout();
    } finally {
      clearSession();
      await client.clear();
    }
  }

  async function removeDevice(id: string) {
    await api.deleteSession(id);
    await sessions.refetch();
  }

  return (
    <main className="app-shell settings-shell">
      <aside className="rail">
        <div className="rail-logo">s</div>
        <div className="rail-actions"><Link className="rail-action" to="/" title="Chats">▤</Link><Link className="rail-action active" to="/settings" title="Profile">◉</Link></div>
        <Link className="rail-avatar" to="/settings" title="Your profile">{initials(user?.name || user?.email || "S")}</Link>
      </aside>
      <section className="workspace">
        <header className="topbar"><div><span className="status-dot" /> Sydex <span className="topbar-divider">/</span> Settings</div><div className="settings-topbar-actions"><Link className="settings-chat-link" to="/">← Chats</Link><button className="quiet-button desktop-sign-out" onClick={() => void logout()}>Sign out</button><div className="mobile-account-menu">
          <button type="button" className="mobile-menu-trigger" aria-label="Open account menu" aria-haspopup="menu" aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen((open) => !open)}><span aria-hidden="true">⋮</span></button>
          {mobileMenuOpen && <><button type="button" className="mobile-menu-dismiss" aria-label="Close menu" onClick={() => setMobileMenuOpen(false)} /><div className="mobile-menu-popover" role="menu">
            <button type="button" role="menuitem" className="delete-account-item" disabled={deleteAccount.isPending} onClick={confirmDeleteAccount}>{deleteAccount.isPending ? "Deleting account…" : "Delete account"}</button>
            <button type="button" role="menuitem" onClick={() => { setMobileMenuOpen(false); void logout(); }}>Log out</button>
            <a role="menuitem" href="mailto:support@sydex.app" onClick={() => setMobileMenuOpen(false)}>Help</a>
          </div></>}
        </div></div></header>
        <div className="content">
          <div className="page-heading"><div className="eyebrow">YOUR ACCOUNT</div><h1>Profile & privacy</h1><p>Make Sydex feel like yours.</p></div>
          {deleteAccount.isError && <p className="error-message" role="alert">{deleteAccount.error.message || "Could not delete your account. Please try again."}</p>}
          <form className="settings-grid" onSubmit={(event) => { event.preventDefault(); update.mutate(); }}>
            <section className="panel profile-panel">
              <div className="panel-heading"><div><h2>Your profile</h2><p>How you appear to people you chat with.</p></div><span className="edit-icon">✳</span></div>
              <div className="profile-preview">
                {form.avatarUrl ? <img src={form.avatarUrl} alt="Profile" /> : <div className="profile-fallback">{initials(form.name || user?.email || "S")}</div>}
                <div><strong>{form.name || "Your name"}</strong><span>{user?.email}</span></div>
              </div>
              <label className="field"><span>Display name</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={80} required /></label>
              <label className="field"><span>About</span><textarea value={form.about} onChange={(event) => setForm({ ...form, about: event.target.value })} maxLength={139} rows={3} placeholder="A little about you" /><small>{form.about.length}/139</small></label>
              <div className="field photo-picker-field"><span>Profile photo</span><div className="photo-picker-actions"><label className="photo-picker-button">Choose photo<input type="file" accept="image/*" onChange={async (event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (!file) return;
                try {
                  setPhotoError("");
                  const avatarUrl = await compressProfilePhoto(file);
                  const nextUser = await api.updateProfile({ avatarUrl });
                  setUser(nextUser);
                  setForm((current) => ({ ...current, avatarUrl: nextUser.avatarUrl ?? "" }));
                  setSaved(true);
                  window.setTimeout(() => setSaved(false), 2500);
                } catch (error) {
                  setPhotoError(error instanceof Error ? error.message : "Could not save this photo.");
                }
              }} /></label>{form.avatarUrl && <button type="button" className="photo-remove-button" onClick={async () => {
                try {
                  setPhotoError("");
                  const nextUser = await api.updateProfile({ avatarUrl: null });
                  setUser(nextUser);
                  setForm((current) => ({ ...current, avatarUrl: "" }));
                  setSaved(true);
                  window.setTimeout(() => setSaved(false), 2500);
                } catch (error) {
                  setPhotoError(error instanceof Error ? error.message : "Could not remove this photo.");
                }
              }}>Remove photo</button>}</div><small>Photo changes save automatically.</small>{photoError && <small className="photo-error" role="alert">{photoError}</small>}</div>
            </section>
            <section className="panel privacy-panel">
              <div className="panel-heading"><div><h2>Privacy</h2><p>Choose what others can see.</p></div><span className="privacy-icon">⌑</span></div>
              <PrivacySelect label="Last seen" value={form.lastSeen} onChange={(value) => setForm({ ...form, lastSeen: value })} />
              <PrivacySelect label="Profile photo" value={form.profilePhoto} onChange={(value) => setForm({ ...form, profilePhoto: value })} />
              <PrivacySelect label="About" value={form.aboutPrivacy} onChange={(value) => setForm({ ...form, aboutPrivacy: value })} />
              <div className="setting-row">
                <div><strong>Read receipts</strong><p>Let people know when you’ve read their messages.</p></div>
                <button type="button" role="switch" aria-checked={form.readReceipts} className={`toggle ${form.readReceipts ? "on" : ""}`} onClick={() => setForm({ ...form, readReceipts: !form.readReceipts })}><span /></button>
              </div>
              <div className="privacy-tip"><span>◇</span><p>Some privacy settings may affect what you can see about others.</p></div>
            </section>
            <section className="panel sessions-panel">
              <div className="panel-heading"><div><h2>Linked devices</h2><p>Manage where you’re signed in.</p></div><span className="device-icon">▣</span></div>
              {sessions.isLoading ? <p className="muted">Loading devices…</p> : sessions.isError ? <p className="error-message">Could not load linked devices.</p> : sessions.data?.map((session) => (
                <div className="device-row" key={session.id}><div className="device-symbol">⌘</div><div className="device-details"><strong>{session.deviceName}</strong><span>{session.current ? "This device · " : ""}Last active {new Date(session.lastActiveAt).toLocaleString()}</span></div>{!session.current && <button type="button" className="device-remove" onClick={() => void removeDevice(session.id)}>Log out</button>}</div>
              ))}
              <button type="button" className="logout-all" onClick={() => void logout(true)}>Log out of all devices</button>
            </section>
            <div className="form-actions"><span className="save-note">{update.isError ? (update.error as Error).message : saved ? "Changes saved" : ""}</span><button className="primary-button save-button" disabled={update.isPending}>{update.isPending ? "Saving…" : "Save changes"}</button></div>
          </form>
        </div>
      </section>
      <nav className="settings-mobile-nav" aria-label="Main navigation">
        <Link to="/">
          <span className="mobile-nav-icon" aria-hidden="true">▤</span><span>Chats</span>
        </Link>
        <Link className="active" to="/settings" aria-current="page">
          <span className="mobile-nav-icon" aria-hidden="true">◉</span><span>Settings</span>
        </Link>
      </nav>
    </main>
  );
}

function PrivacySelect({ label, value, onChange }: { label: string; value: PrivacySetting; onChange: (value: PrivacySetting) => void }) {
  return <label className="select-row"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value as PrivacySetting)}><option value="everyone">Everyone</option><option value="contacts">My contacts</option><option value="nobody">Nobody</option></select></label>;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read the recording."));
    reader.onerror = () => reject(new Error("Could not read the recording."));
    reader.readAsDataURL(blob);
  });
}

async function compressChatImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  const bitmap = await createImageBitmap(file);
  try {
    for (const maxSize of [1280, 1024, 768, 512, 384]) {
      const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not prepare this photo.");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.82, 0.72, 0.62, 0.52, 0.42]) {
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        if (dataUrl.length <= 120_000) return dataUrl;
      }
    }
  } finally {
    bitmap.close();
  }
  throw new Error("This photo is too large to send. Try a different image.");
}

async function compressProfilePhoto(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  const bitmap = await createImageBitmap(file);
  try {
    for (const maxSize of [256, 192, 128]) {
      const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not prepare this photo.");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.76, 0.62, 0.48]) {
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        if (dataUrl.length <= 24_000) return dataUrl;
      }
    }
  } finally {
    bitmap.close();
  }
  throw new Error("This photo could not be reduced enough. Try a smaller image.");
}

function initials(value: string): string {
  return value.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}

function readFavoriteIds(userId: string): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(`sydex:favorites:${userId}`) ?? "[]") as unknown;
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : [];
  } catch (error) {
    console.warn("Could not read saved chat favorites.", error);
    return [];
  }
}

export default App;
