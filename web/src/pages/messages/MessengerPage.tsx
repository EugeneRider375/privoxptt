import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Hash, MessageSquare, Send, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { messagesApi } from '@/api/client';
import { clearNativeMessageNotifications } from '@/hooks/useNativePush';
import { PRIVOX_MESSAGE_NEW_EVENT, useSocket } from '@/hooks/useSocket';
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
  const [error, setError] = useState<string | null>(null);
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState === 'visible');
  const endRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);

  const selected = useMemo(
    () => conversations.find((item) => item.id === selectedId && item.type === selectedType) ?? null,
    [conversations, selectedId, selectedType],
  );

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
                    {conversation.lastMessage?.body ?? conversation.subtitle ?? 'No messages yet'}
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
              <div>
                <p className="font-rajdhani font-bold">{selected.title}</p>
                <p className="font-mono text-[10px] text-ptt-muted">
                  {selected.type === 'group' ? 'GROUP CHAT' : selected.subtitle}
                </p>
              </div>
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
                      <p className="font-rajdhani text-sm whitespace-pre-wrap break-words">{message.body}</p>
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
                disabled={sending}
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
