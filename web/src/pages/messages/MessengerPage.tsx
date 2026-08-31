import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { isAxiosError } from 'axios';
import { ArrowLeft, Camera, Download, FileText, Hash, Image, Mic, MessageSquare, Paperclip, Send, Square, Trash2, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { messagesApi } from '@/api/client';
import { clearNativeMessageNotifications } from '@/hooks/useNativePush';
import {
  PRIVOX_MESSAGE_CLEARED_EVENT,
  PRIVOX_MESSAGE_DELETED_EVENT,
  PRIVOX_MESSAGE_NEW_EVENT,
  useSocket,
} from '@/hooks/useSocket';
import { useStore } from '@/store/useStore';
import type { ChatConversation, ChatMessage } from '@/types';

function targetFor(conversation: ChatConversation) {
  return conversation.type === 'group'
    ? { groupId: conversation.id }
    : { userId: conversation.id };
}

function belongsToConversation(
  message: ChatMessage,
  conversation: ChatConversation,
  currentUserId: string,
) {
  if (conversation.type === 'group') return message.groupId === conversation.id;
  return (
    (message.senderId === currentUserId && message.recipientId === conversation.id) ||
    (message.senderId === conversation.id && message.recipientId === currentUserId)
  );
}

function timeLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function fileSizeLabel(size: number) {
  return size >= 1024 * 1024
    ? `${(size / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(size / 1024))} KB`;
}

function requestErrorMessage(error: unknown, fallback: string) {
  if (isAxiosError<{ error?: string }>(error)) {
    return error.response?.data?.error ?? error.message ?? fallback;
  }
  return error instanceof Error ? error.message : fallback;
}

// Явно просим mp4/aac, а не дефолтный webm/opus в Chrome: WebKit (iOS) годами
// не может проиграть webm/opus именно из blob-URL (см.
// bugs.webkit.org/show_bug.cgi?id=245428) — на живом тесте 2026-08-31 это
// проявилось так: голосовое с Android на iPhone доходило, "слушалось" и
// самоудалялось, но звука не было вообще. iPhone по умолчанию и так
// записывает в mp4/aac, поэтому в обратную сторону всё работало.
const VOICE_NOTE_MIME_CANDIDATES = [
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/webm;codecs=opus',
  'audio/webm',
];

function pickVoiceNoteMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return undefined;
  return VOICE_NOTE_MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

function MessageAttachment({ message, currentUserId }: { message: ChatMessage; currentUserId?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const listenedRef = useRef(false);
  const attachment = message.attachment;
  const isImage = attachment?.type.startsWith('image/');
  const isVoiceNote = attachment?.type.startsWith('audio/');
  const isRecipient = message.recipientId === currentUserId;

  useEffect(() => {
    if (!attachment || !(isImage || isVoiceNote)) return;
    let disposed = false;
    let objectUrl: string | null = null;
    messagesApi.attachment(message.id).then((blob) => {
      if (disposed) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => {});
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment, isImage, isVoiceNote, message.id]);

  if (!attachment) return null;

  const download = async () => {
    setLoading(true);
    try {
      const blob = await messagesApi.attachment(message.id);
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = attachment.name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } finally {
      setLoading(false);
    }
  };

  if (isVoiceNote) {
    return (
      <div className="space-y-1 min-w-[180px]">
        <div className="flex items-center gap-2">
          <Mic className="w-4 h-4 shrink-0 text-ptt-blue" />
          {url ? (
            <audio
              controls
              src={url}
              className="h-8 max-w-[220px]"
              onEnded={() => {
                if (listenedRef.current || !isRecipient) return;
                listenedRef.current = true;
                messagesApi.markListened(message.id).catch(() => {});
              }}
            />
          ) : (
            <span className="text-xs text-ptt-muted">Loading…</span>
          )}
        </div>
        {/* D34 debug 2026-08-31: временная подпись формата, убрать после
            диагностики "нет звука Android→iPhone" */}
        <p className="text-[9px] text-ptt-muted">{attachment.type} · {attachment.name}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {isImage && url && (
        <button type="button" onClick={download} className="block">
          <img
            src={url}
            alt={attachment.name}
            className="max-h-64 max-w-full rounded object-contain"
          />
        </button>
      )}
      <button
        type="button"
        onClick={download}
        disabled={loading}
        className="w-full flex items-center gap-2 text-left text-xs text-ptt-blue disabled:opacity-50"
      >
        {isImage ? <Image className="w-4 h-4 shrink-0" /> : <FileText className="w-4 h-4 shrink-0" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate">{attachment.name}</span>
          <span className="text-[9px] text-ptt-muted">{fileSizeLabel(attachment.size)}</span>
        </span>
        <Download className="w-4 h-4 shrink-0" />
      </button>
    </div>
  );
}

export function MessengerPage({ embedded = false }: { embedded?: boolean }) {
  useSocket();
  const navigate = useNavigate();
  const user = useStore((state) => state.user);
  const setUnreadMessageCount = useStore((state) => state.setUnreadMessageCount);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<'group' | 'direct' | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState === 'visible');
  const [recording, setRecording] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  const selected = useMemo(
    () => conversations.find((item) => item.id === selectedId && item.type === selectedType) ?? null,
    [conversations, selectedId, selectedType],
  );
  const canClearSelected = selected?.type === 'direct'
    || user?.role === 'SUPERADMIN'
    || user?.role === 'ADMIN'
    || user?.role === 'DISPATCHER';

  const loadConversations = useCallback(async () => {
    const data = await messagesApi.conversations() as ChatConversation[];
    setConversations(data);
    setUnreadMessageCount(data.reduce((total, item) => total + item.unreadCount, 0));
    if (embedded) {
      setSelectedId((current) => current ?? data[0]?.id ?? null);
      setSelectedType((current) => current ?? data[0]?.type ?? null);
    }
  }, [embedded, setUnreadMessageCount]);

  useEffect(() => {
    setLoading(true);
    loadConversations()
      .catch((err) => setError(err instanceof Error ? err.message : 'Unable to load conversations'))
      .finally(() => setLoading(false));
  }, [loadConversations]);

  useEffect(() => {
    const onVisibilityChange = () => setPageVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  const markConversationRead = useCallback(async (conversation: ChatConversation) => {
    const target = targetFor(conversation);
    await messagesApi.markRead(target);
    await clearNativeMessageNotifications(target).catch(() => {});
    setConversations((items) => {
      const next = items.map((item) =>
        item.id === conversation.id && item.type === conversation.type
          ? { ...item, unreadCount: 0 }
          : item
      );
      setUnreadMessageCount(next.reduce((total, item) => total + item.unreadCount, 0));
      return next;
    });
  }, [setUnreadMessageCount]);

  useEffect(() => {
    if (!selected) {
      setMessages([]);
      return;
    }
    setError(null);
    messagesApi.history(targetFor(selected))
      .then((result) => setMessages(result.messages))
      .catch((err) => setError(err instanceof Error ? err.message : 'Unable to load messages'));
  }, [selected?.id, selected?.type]);

  useEffect(() => {
    if (!selected || !pageVisible) return;
    markConversationRead(selected)
      .catch((err) => setError(err instanceof Error ? err.message : 'Unable to mark messages as read'));
  }, [markConversationRead, pageVisible, selected?.id, selected?.type]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  useEffect(() => {
    const onMessage = (event: Event) => {
      const message = (event as CustomEvent<ChatMessage>).detail;
      if (!message || !user) return;
      setConversations((items) => {
        const next = items.map((item) => {
          if (!belongsToConversation(message, item, user.id)) return item;
          const isOpen = document.visibilityState === 'visible'
            && item.id === selectedId
            && item.type === selectedType;
          return {
            ...item,
            lastMessage: message,
            unreadCount: isOpen || message.senderId === user.id ? 0 : item.unreadCount + 1,
          };
        });
        setUnreadMessageCount(next.reduce((total, item) => total + item.unreadCount, 0));
        return next;
      });
      if (selected && belongsToConversation(message, selected, user.id)) {
        setMessages((items) => items.some((item) => item.id === message.id) ? items : [...items, message]);
        if (message.senderId !== user.id && document.visibilityState === 'visible') {
          markConversationRead(selected).catch(() => {});
        }
      }
    };
    window.addEventListener(PRIVOX_MESSAGE_NEW_EVENT, onMessage);
    return () => window.removeEventListener(PRIVOX_MESSAGE_NEW_EVENT, onMessage);
  }, [markConversationRead, selected, selectedId, selectedType, setUnreadMessageCount, user]);

  useEffect(() => {
    const onCleared = (event: Event) => {
      const target = (event as CustomEvent<{ groupId?: string; userId?: string }>).detail;
      if (!target) return;
      const matches = (conversation: ChatConversation) =>
        conversation.type === 'group'
          ? conversation.id === target.groupId
          : conversation.id === target.userId;

      setConversations((items) => {
        const next = items.map((item) =>
          matches(item) ? { ...item, lastMessage: null, unreadCount: 0 } : item
        );
        setUnreadMessageCount(next.reduce((total, item) => total + item.unreadCount, 0));
        return next;
      });
      if (selected && matches(selected)) {
        setMessages([]);
        clearNativeMessageNotifications(target).catch(() => {});
      }
    };
    window.addEventListener(PRIVOX_MESSAGE_CLEARED_EVENT, onCleared);
    return () => window.removeEventListener(PRIVOX_MESSAGE_CLEARED_EVENT, onCleared);
  }, [selected, setUnreadMessageCount]);

  useEffect(() => {
    const onDeleted = (event: Event) => {
      const { messageId } = (event as CustomEvent<{ messageId: string }>).detail ?? {};
      if (!messageId) return;
      setMessages((items) => items.filter((item) => item.id !== messageId));
    };
    window.addEventListener(PRIVOX_MESSAGE_DELETED_EVENT, onDeleted);
    return () => window.removeEventListener(PRIVOX_MESSAGE_DELETED_EVENT, onDeleted);
  }, []);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const textarea = event.currentTarget.elements.namedItem('message');
    const body = textarea instanceof HTMLTextAreaElement ? textarea.value.trim() : draft.trim();
    if (!selected || !body || sending) return;
    setSending(true);
    setError(null);
    try {
      const created = await messagesApi.send({ ...targetFor(selected), body }) as ChatMessage;
      setMessages((items) => items.some((item) => item.id === created.id) ? items : [...items, created]);
      setConversations((items) => items.map((item) =>
        item.id === selected.id && item.type === selected.type
          ? { ...item, lastMessage: created }
          : item
      ));
      setDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send message');
    } finally {
      setSending(false);
    }
  }

  async function clearHistory() {
    if (!selected || !canClearSelected || clearing) return;
    const scope = selected.type === 'group' ? 'all group members' : 'both participants';
    if (!confirm(`Delete the entire history with "${selected.title}" for ${scope}? This cannot be undone.`)) {
      return;
    }

    setClearing(true);
    setError(null);
    try {
      const target = targetFor(selected);
      await messagesApi.clearHistory(target);
      await clearNativeMessageNotifications(target).catch(() => {});
      setMessages([]);
      setConversations((items) => {
        const next = items.map((item) =>
          item.id === selected.id && item.type === selected.type
            ? { ...item, lastMessage: null, unreadCount: 0 }
            : item
        );
        setUnreadMessageCount(next.reduce((total, item) => total + item.unreadCount, 0));
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to clear message history');
    } finally {
      setClearing(false);
    }
  }

  async function sendAttachment(file: File) {
    if (!selected || uploading) return;
    if (file.size > 25 * 1024 * 1024) {
      setError('File is larger than 25 MB');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const created = await messagesApi.sendAttachment(file, targetFor(selected)) as ChatMessage;
      setMessages((items) => items.some((item) => item.id === created.id) ? items : [...items, created]);
      setConversations((items) => items.map((item) =>
        item.id === selected.id && item.type === selected.type
          ? { ...item, lastMessage: created }
          : item
      ));
    } catch (err) {
      setError(requestErrorMessage(err, 'Unable to send attachment'));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (cameraInputRef.current) cameraInputRef.current.value = '';
    }
  }

  // Голосовые сообщения (D34) — только личка (кнопка вообще не показывается
  // в групповых чатах, см. selected?.type === 'direct' ниже).
  async function startRecording() {
    if (recording || !selected || selected.type !== 'direct') return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickVoiceNoteMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recordedChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const extension = blob.type.includes('mp4') ? 'm4a' : 'webm';
        void sendAttachment(new File([blob], `voice-note.${extension}`, { type: blob.type }));
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setError('Microphone access is required to record a voice message');
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setRecording(false);
  }

  const content = (
    <div className="h-full min-h-0 grid md:grid-cols-[280px_1fr] bg-ptt-dark text-white">
      <aside className={`${selected ? 'hidden md:flex' : 'flex'} min-h-0 flex-col border-r border-ptt-border bg-ptt-panel`}>
        <div className="flex items-center gap-3 px-4 h-14 border-b border-ptt-border">
          {!embedded && (
            <button onClick={() => navigate(-1)} className="text-ptt-muted hover:text-white">
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <MessageSquare className="w-5 h-5 text-ptt-green" />
          <div>
            <p className="font-rajdhani font-bold">MESSAGES</p>
            <p className="font-mono text-[10px] text-ptt-muted">{user?.callsign}</p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading && <p className="p-4 font-mono text-xs text-ptt-muted">LOADING...</p>}
          {!loading && conversations.length === 0 && (
            <p className="p-4 font-mono text-xs text-ptt-muted">NO CONVERSATIONS</p>
          )}
          {conversations.map((conversation) => {
            const active = conversation.id === selectedId && conversation.type === selectedType;
            return (
              <button
                key={`${conversation.type}:${conversation.id}`}
                onClick={() => {
                  setSelectedId(conversation.id);
                  setSelectedType(conversation.type);
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left border-b border-ptt-border/40 ${
                  active ? 'bg-ptt-green/10' : 'hover:bg-ptt-muted/20'
                }`}
              >
                <div
                  className="w-9 h-9 rounded-full border border-ptt-border flex items-center justify-center shrink-0"
                  style={conversation.color ? { borderColor: conversation.color } : undefined}
                >
                  {conversation.type === 'group'
                    ? <Hash className="w-4 h-4" style={{ color: conversation.color }} />
                    : <UserRound className="w-4 h-4 text-ptt-blue" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-rajdhani font-semibold truncate">{conversation.title}</p>
                  <p className="font-mono text-[10px] text-ptt-muted truncate">
                    {conversation.lastMessage?.attachment?.name
                      ?? conversation.lastMessage?.body
                      ?? conversation.subtitle
                      ?? 'No messages yet'}
                  </p>
                </div>
                {conversation.unreadCount > 0 && (
                  <span className="min-w-5 h-5 px-1 rounded-full bg-ptt-green text-ptt-dark font-mono text-[10px] flex items-center justify-center">
                    {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </aside>

      <section className={`${selected ? 'flex' : 'hidden md:flex'} min-h-0 flex-col`}>
        {selected ? (
          <>
            <header className="h-14 px-4 flex items-center gap-3 border-b border-ptt-border bg-ptt-panel">
              <button
                onClick={() => {
                  setSelectedId(null);
                  setSelectedType(null);
                }}
                className="md:hidden text-ptt-muted hover:text-white"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              {selected.type === 'group'
                ? <Hash className="w-5 h-5" style={{ color: selected.color }} />
                : <UserRound className="w-5 h-5 text-ptt-blue" />}
              <div className="min-w-0 flex-1">
                <p className="font-rajdhani font-bold">{selected.title}</p>
                <p className="font-mono text-[10px] text-ptt-muted">
                  {selected.type === 'group' ? 'GROUP CHAT' : selected.subtitle}
                </p>
              </div>
              {canClearSelected && (
                <button
                  type="button"
                  onClick={clearHistory}
                  disabled={clearing}
                  title="Delete message history for everyone"
                  className="ml-auto p-2 text-ptt-muted hover:text-ptt-danger disabled:opacity-40"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </header>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 && (
                <div className="h-full flex items-center justify-center">
                  <p className="font-mono text-xs text-ptt-muted">NO MESSAGES YET</p>
                </div>
              )}
              {messages.map((message) => {
                const own = message.senderId === user?.id;
                return (
                  <div key={message.id} className={`flex ${own ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[82%] rounded-lg px-3 py-2 border ${
                      own
                        ? 'bg-ptt-green/15 border-ptt-green/30'
                        : 'bg-ptt-card border-ptt-border'
                    }`}>
                      {!own && (
                        <p className="font-mono text-[10px] text-ptt-blue mb-1">{message.sender.callsign}</p>
                      )}
                      {message.body && (
                        <p className="font-rajdhani text-sm whitespace-pre-wrap break-words">{message.body}</p>
                      )}
                      <MessageAttachment message={message} currentUserId={user?.id} />
                      <p className="mt-1 text-right font-mono text-[9px] text-ptt-muted">
                        {timeLabel(message.createdAt)}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>
            {error && <p className="px-4 py-2 text-xs text-ptt-danger border-t border-ptt-border">{error}</p>}
            <form onSubmit={sendMessage} className="p-3 border-t border-ptt-border bg-ptt-panel flex gap-2">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept="image/*,application/pdf,text/plain,text/csv,.doc,.docx,.xls,.xlsx"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void sendAttachment(file);
                }}
              />
              <input
                ref={cameraInputRef}
                type="file"
                className="hidden"
                accept="image/*"
                capture="environment"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void sendAttachment(file);
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || sending}
                title="Attach photo or file"
                className="w-10 h-10 shrink-0 flex items-center justify-center text-ptt-muted hover:text-ptt-green disabled:opacity-40"
              >
                <Paperclip className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                disabled={uploading || sending}
                title="Take a photo"
                className="w-10 h-10 shrink-0 flex items-center justify-center text-ptt-muted hover:text-ptt-green disabled:opacity-40"
              >
                <Camera className="w-4 h-4" />
              </button>
              {selected.type === 'direct' && (
                <button
                  type="button"
                  onClick={() => (recording ? stopRecording() : startRecording())}
                  disabled={uploading || sending}
                  title={recording ? 'Stop recording' : 'Record a voice message'}
                  className={`w-10 h-10 shrink-0 flex items-center justify-center disabled:opacity-40 ${
                    recording ? 'text-ptt-danger' : 'text-ptt-muted hover:text-ptt-green'
                  }`}
                >
                  {recording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>
              )}
              <textarea
                name="message"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onInput={(event) => setDraft(event.currentTarget.value)}
                onCompositionStart={() => {
                  composingRef.current = true;
                }}
                onCompositionEnd={(event) => {
                  composingRef.current = false;
                  setDraft(event.currentTarget.value);
                }}
                onKeyDown={(event) => {
                  const isComposing = composingRef.current
                    || (event.nativeEvent as KeyboardEvent).isComposing;
                  if (event.key === 'Enter' && !event.shiftKey && !isComposing) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                maxLength={4000}
                rows={1}
                placeholder="Write a message"
                className="flex-1 min-h-10 max-h-28 resize-none rounded border border-ptt-border bg-ptt-dark px-3 py-2 text-sm outline-none focus:border-ptt-green"
              />
              <button
                type="submit"
                disabled={sending || uploading}
                className="w-11 h-10 rounded bg-ptt-green text-ptt-dark flex items-center justify-center disabled:opacity-40"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </>
        ) : (
          <div className="h-full flex items-center justify-center">
            <p className="font-mono text-xs text-ptt-muted">SELECT A CONVERSATION</p>
          </div>
        )}
      </section>
    </div>
  );

  return embedded ? content : <div className="h-full bg-ptt-dark">{content}</div>;
}
