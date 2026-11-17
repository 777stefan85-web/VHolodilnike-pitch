import { useCallback, useEffect, useRef, useState } from 'react';
import Peer, { DataConnection } from 'peerjs';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  AuthorProfile,
  ClientMutation,
  RoomState,
  SyncMessage,
} from '../types/collaboration';
import { applyMutation, createInitialRoomState } from '../utils/roomState';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase';

export type TransportMode =
  | 'connecting'
  | 'firebase'
  | 'websocket'
  | 'p2p-host'
  | 'p2p-guest'
  | 'local';

interface UseRealtimeRoomOptions {
  roomId: string;
  user: { id: string; name: string; color: string };
}

function getLocalRoomKey(roomId: string) {
  return `vh_room_state_${roomId}`;
}

function getRoomShareKeyStorage(roomId: string) {
  return `vh_room_key_${roomId}`;
}

function getShareKeyFromUrlOrStorage(roomId: string): string | null {
  const params = new URLSearchParams(window.location.search);
  const urlKey = params.get('key')?.trim();
  if (urlKey && /^[a-zA-Z0-9_-]{8,64}$/.test(urlKey)) {
    try {
      localStorage.setItem(getRoomShareKeyStorage(roomId), urlKey);
    } catch {
      // ignore
    }
    return urlKey;
  }
  try {
    return localStorage.getItem(getRoomShareKeyStorage(roomId));
  } catch {
    return null;
  }
}

function generateShareToken(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let token = '';
  for (let i = 0; i < 14; i++) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}

function loadLocalRoomState(roomId: string): RoomState {
  try {
    const raw = localStorage.getItem(getLocalRoomKey(roomId));
    if (raw) {
      const parsed = JSON.parse(raw) as RoomState;
      if (parsed && Array.isArray(parsed.sections) && Array.isArray(parsed.slideTheses)) {
        return parsed;
      }
    }
  } catch {
    // Fallback
  }
  return createInitialRoomState(roomId);
}

function saveLocalRoomState(roomId: string, state: RoomState) {
  try {
    localStorage.setItem(getLocalRoomKey(roomId), JSON.stringify(state));
  } catch {
    // Ignore storage limit
  }
}

function sanitizeAuthorsMap(
  authors: Record<string, { name: string; color: string }>
): Record<string, { name: string; color: string }> {
  const entries = Object.entries(authors).slice(0, 20);
  const out: Record<string, { name: string; color: string }> = {};
  for (const [k, v] of entries) {
    out[k.slice(0, 64)] = {
      name: (v?.name || 'Соавтор').slice(0, 40),
      color: /^#[0-9a-fA-F]{3,8}$/.test(v?.color || '') ? v.color : '#BFDBFE',
    };
  }
  return out;
}

function sanitizeFirestorePayload(state: RoomState) {
  // Enforce blueprint volumetric constraints (sections: 1..30, slideTheses: 1..40, authors <= 20)
  const sections =
    state.sections.length > 0
      ? state.sections.slice(0, 30)
      : createInitialRoomState(state.roomId).sections;
  const slideTheses =
    state.slideTheses.length > 0
      ? state.slideTheses.slice(0, 40)
      : createInitialRoomState(state.roomId).slideTheses;

  return {
    version: Math.max(1, Math.floor(state.version || 1)),
    sections,
    slideTheses,
    authors: sanitizeAuthorsMap(state.authors),
  };
}

export function useRealtimeRoom({ roomId, user }: UseRealtimeRoomOptions) {
  const [roomState, setRoomState] = useState<RoomState>(() => loadLocalRoomState(roomId));
  const [activeUsers, setActiveUsers] = useState<AuthorProfile[]>([]);
  const [transport, setTransport] = useState<TransportMode>('connecting');

  // Firebase Auth + Firestore state
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [firebaseReady, setFirebaseReady] = useState(false);
  const [shareToken, setShareToken] = useState<string | null>(() =>
    getShareKeyFromUrlOrStorage(roomId)
  );
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [cloudSaving, setCloudSaving] = useState(false);

  const stateRef = useRef(roomState);
  stateRef.current = roomState;

  const userRef = useRef(user);
  userRef.current = user;

  const firebaseReadyRef = useRef(false);
  firebaseReadyRef.current = firebaseReady;

  const wsRef = useRef<WebSocket | null>(null);
  const bcRef = useRef<BroadcastChannel | null>(null);
  const peerRef = useRef<Peer | null>(null);
  const hostConnsRef = useRef<Map<string, DataConnection>>(new Map());
  const guestConnRef = useRef<DataConnection | null>(null);
  const peerPresenceRef = useRef<Map<string, AuthorProfile>>(new Map());
  const seenOpsRef = useRef<Set<string>>(new Set());
  const firestoreWriteTimerRef = useRef<number | null>(null);

  // Persist locally whenever state updates
  useEffect(() => {
    saveLocalRoomState(roomId, roomState);
  }, [roomId, roomState]);

  // Listen to Firebase Auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setFirebaseUser(u);
      setAuthReady(true);
      if (!u) {
        setFirebaseReady(false);
        setCloudError(null);
      }
    });
    return () => unsub();
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setCloudError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Не удалось войти через Google';
      if (!msg.includes('popup-closed-by-user')) {
        setCloudError(msg);
      }
    }
  }, []);

  const signOutGoogle = useCallback(async () => {
    setCloudError(null);
    setFirebaseReady(false);
    await signOut(auth);
  }, []);

  const flushToFirestore = useCallback(
    async (nextState: RoomState) => {
      if (!firebaseReadyRef.current || !auth.currentUser) return;
      const path = `rooms/${roomId}`;
      setCloudSaving(true);
      try {
        const sanitized = sanitizeFirestorePayload(nextState);
        await updateDoc(doc(db, 'rooms', roomId), {
          ...sanitized,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('Quota exceeded')) {
          setCloudError('Превышена дневная квота Firestore (сбросится завтра).');
        } else {
          setCloudError('Ошибка сохранения в облако Firestore.');
          try {
            handleFirestoreError(err, OperationType.UPDATE, path);
          } catch {
            // Logged structured FirestoreErrorInfo
          }
        }
      } finally {
        setCloudSaving(false);
      }
    },
    [roomId]
  );

  const scheduleFirestoreSync = useCallback(
    (nextState: RoomState, immediate = false) => {
      if (!firebaseReadyRef.current) return;
      if (firestoreWriteTimerRef.current) {
        window.clearTimeout(firestoreWriteTimerRef.current);
        firestoreWriteTimerRef.current = null;
      }
      if (immediate) {
        void flushToFirestore(nextState);
      } else {
        firestoreWriteTimerRef.current = window.setTimeout(() => {
          void flushToFirestore(stateRef.current);
        }, 420);
      }
    },
    [flushToFirestore]
  );

  // Attach Firestore room membership & real-time onSnapshot when authenticated
  useEffect(() => {
    if (!authReady || !firebaseUser) return;
    if (!firebaseUser.emailVerified) {
      setCloudError('Для облачной синхронизации подтвердите email в аккаунте Google.');
      return;
    }

    let cancelled = false;
    let unsubSnapshot: (() => void) | null = null;
    const safeRoomId = roomId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'vholodilnike';
    const roomRef = doc(db, 'rooms', safeRoomId);
    const memberRef = doc(db, 'rooms', safeRoomId, 'members', firebaseUser.uid);

    const startListener = () => {
      unsubSnapshot = onSnapshot(
        roomRef,
        (snap) => {
          if (cancelled || !snap.exists()) return;
          const data = snap.data() as {
            version?: number;
            sections?: RoomState['sections'];
            slideTheses?: RoomState['slideTheses'];
            authors?: RoomState['authors'];
            shareToken?: string;
          };
          if (data.shareToken) {
            setShareToken(data.shareToken);
            try {
              localStorage.setItem(getRoomShareKeyStorage(safeRoomId), data.shareToken);
            } catch {
              // ignore
            }
          }
          if (snap.metadata.hasPendingWrites) return;
          if (Array.isArray(data.sections) && Array.isArray(data.slideTheses)) {
            setRoomState((prev) => {
              const incomingVersion = typeof data.version === 'number' ? data.version : prev.version;
              if (incomingVersion < prev.version) return prev;
              const merged: RoomState = {
                roomId: safeRoomId,
                version: incomingVersion,
                sections: data.sections!,
                slideTheses: data.slideTheses!,
                authors: data.authors || prev.authors,
              };
              stateRef.current = merged;
              return merged;
            });
          }
          setFirebaseReady(true);
          setTransport('firebase');
          setCloudError(null);
        },
        (error) => {
          if (cancelled) return;
          setFirebaseReady(false);
          setCloudError('Нет доступа к облачной комнате Firestore.');
          try {
            handleFirestoreError(error, OperationType.GET, `rooms/${safeRoomId}`);
          } catch {
            // Structured error logged
          }
        }
      );
    };

    const bootstrapRoomAccess = async () => {
      try {
        // Check if current user already has access to the room
        const existingSnap = await getDoc(roomRef);
        if (cancelled) return;

        if (existingSnap.exists()) {
          const data = existingSnap.data() as { shareToken?: string; ownerUid?: string };
          if (data.shareToken) {
            setShareToken(data.shareToken);
            try {
              localStorage.setItem(getRoomShareKeyStorage(safeRoomId), data.shareToken);
            } catch {
              // ignore
            }
          }
          // Ensure owner also has a member doc if missing
          const memberSnap = await getDoc(memberRef).catch(() => null);
          if (!memberSnap?.exists() && data.ownerUid === firebaseUser.uid && data.shareToken) {
            await setDoc(memberRef, {
              uid: firebaseUser.uid,
              role: 'owner',
              displayName: (userRef.current.name || firebaseUser.displayName || 'Автор').slice(0, 40),
              color: userRef.current.color,
              joinToken: data.shareToken,
              joinedAt: serverTimestamp(),
            });
          }
          startListener();
          return;
        }
      } catch {
        // getDoc fails with permission-denied either if room doesn't exist OR user isn't a member yet
      }

      if (cancelled) return;
      const providedKey = getShareKeyFromUrlOrStorage(safeRoomId);

      // If an invite key is present in URL/storage, try joining as an editor first
      if (providedKey) {
        try {
          await setDoc(memberRef, {
            uid: firebaseUser.uid,
            role: 'editor',
            displayName: (userRef.current.name || firebaseUser.displayName || 'Соавтор').slice(0, 40),
            color: userRef.current.color,
            joinToken: providedKey,
            joinedAt: serverTimestamp(),
          });
          if (!cancelled) startListener();
          return;
        } catch {
          // Room might not exist yet -> fall through to atomic room creation with this key
        }
      }

      if (cancelled) return;
      const newToken = providedKey || generateShareToken();
      const sanitized = sanitizeFirestorePayload(stateRef.current);
      const batch = writeBatch(db);
      batch.set(roomRef, {
        roomId: safeRoomId,
        ownerUid: firebaseUser.uid,
        shareToken: newToken,
        ...sanitized,
        authors: sanitizeAuthorsMap({
          ...sanitized.authors,
          [userRef.current.id]: { name: userRef.current.name, color: userRef.current.color },
        }),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(memberRef, {
        uid: firebaseUser.uid,
        role: 'owner',
        displayName: (userRef.current.name || firebaseUser.displayName || 'Автор').slice(0, 40),
        color: userRef.current.color,
        joinToken: newToken,
        joinedAt: serverTimestamp(),
      });

      try {
        await batch.commit();
        if (cancelled) return;
        setShareToken(newToken);
        try {
          localStorage.setItem(getRoomShareKeyStorage(safeRoomId), newToken);
        } catch {
          // ignore
        }
        startListener();
      } catch (err) {
        if (cancelled) return;
        setCloudError(
          'Эта облачная комната принадлежит другому пользователю. Попросите ссылку-приглашение с ключом (?key=...) или создайте новую комнату.'
        );
        try {
          handleFirestoreError(err, OperationType.WRITE, `rooms/${safeRoomId}`);
        } catch {
          // Logged structured info
        }
      }
    };

    void bootstrapRoomAccess();

    return () => {
      cancelled = true;
      if (unsubSnapshot) unsubSnapshot();
      if (firestoreWriteTimerRef.current) {
        window.clearTimeout(firestoreWriteTimerRef.current);
      }
    };
  }, [authReady, firebaseUser, roomId]);

  const applyIncomingMutation = useCallback((msg: ClientMutation) => {
    if (seenOpsRef.current.has(msg.clientOpId)) return;
    seenOpsRef.current.add(msg.clientOpId);
    if (seenOpsRef.current.size > 400) {
      const first = seenOpsRef.current.values().next().value;
      if (first) seenOpsRef.current.delete(first);
    }
    setRoomState((prev) => {
      const next = applyMutation(prev, msg);
      stateRef.current = next;
      return next;
    });
  }, []);

  // WebSocket (Node server) + WebRTC P2P (GitHub Pages fallback) + BroadcastChannel
  useEffect(() => {
    let disposed = false;
    let reconnectTimer: number | null = null;

    const bc = new BroadcastChannel(`vh_room_${roomId}`);
    bcRef.current = bc;
    bc.onmessage = (ev) => {
      const msg = ev.data as SyncMessage;
      if (!msg) return;
      if ('clientOpId' in msg) {
        applyIncomingMutation(msg);
      }
    };

    const startP2PFallback = () => {
      if (disposed) return;
      const safeRoom = roomId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || 'vholodilnike';
      const hostPeerId = `vhp-host-${safeRoom}`;

      const cleanupPeer = () => {
        if (peerRef.current) {
          try {
            peerRef.current.destroy();
          } catch {
            // ignore
          }
          peerRef.current = null;
        }
        hostConnsRef.current.clear();
        guestConnRef.current = null;
      };

      const broadcastAsHost = (msg: SyncMessage, excludePeerId?: string) => {
        for (const [pid, conn] of hostConnsRef.current.entries()) {
          if (pid !== excludePeerId && conn.open) {
            try {
              conn.send(msg);
            } catch {
              // ignore
            }
          }
        }
      };

      const getPeerUsersList = (): AuthorProfile[] => {
        const self: AuthorProfile = {
          id: userRef.current.id,
          name: userRef.current.name,
          color: userRef.current.color,
          lastSeen: Date.now(),
        };
        const map = new Map<string, AuthorProfile>([[self.id, self]]);
        for (const p of peerPresenceRef.current.values()) {
          map.set(p.id, p);
        }
        return Array.from(map.values());
      };

      const connectAsGuest = () => {
        if (disposed) return;
        cleanupPeer();
        const guestPeer = new Peer();
        peerRef.current = guestPeer;

        guestPeer.on('open', () => {
          if (disposed) return;
          const conn = guestPeer.connect(hostPeerId, { reliable: true });
          guestConnRef.current = conn;

          conn.on('open', () => {
            if (disposed) return;
            if (!firebaseReadyRef.current) setTransport('p2p-guest');
            conn.send({
              type: 'room:join',
              roomId,
              user: { ...userRef.current, lastSeen: Date.now() },
            } satisfies SyncMessage);
          });

          conn.on('data', (raw) => {
            const msg = raw as SyncMessage;
            if (!msg) return;
            if (msg.type === 'room:state') {
              if (!firebaseReadyRef.current) {
                setRoomState(msg.state);
                stateRef.current = msg.state;
              }
              setActiveUsers(msg.activeUsers);
            } else if (msg.type === 'presence:list') {
              setActiveUsers(msg.activeUsers);
            } else if ('clientOpId' in msg) {
              applyIncomingMutation(msg);
            }
          });

          conn.on('close', () => {
            if (!disposed) {
              if (!firebaseReadyRef.current) setTransport('local');
              reconnectTimer = window.setTimeout(tryClaimHost, 800);
            }
          });

          conn.on('error', () => {
            if (!disposed && !firebaseReadyRef.current) setTransport('local');
          });
        });

        guestPeer.on('error', () => {
          if (!disposed && !firebaseReadyRef.current) setTransport('local');
        });
      };

      const tryClaimHost = () => {
        if (disposed) return;
        cleanupPeer();
        const hostPeer = new Peer(hostPeerId);
        peerRef.current = hostPeer;

        hostPeer.on('open', () => {
          if (disposed) return;
          if (!firebaseReadyRef.current) setTransport('p2p-host');
          setActiveUsers(getPeerUsersList());

          hostPeer.on('connection', (conn) => {
            hostConnsRef.current.set(conn.peer, conn);

            conn.on('data', (raw) => {
              const msg = raw as SyncMessage;
              if (!msg) return;

              if (msg.type === 'room:join' || msg.type === 'presence:update') {
                peerPresenceRef.current.set(conn.peer, msg.user);
                if (msg.type === 'room:join') {
                  const updatedAuthors = {
                    ...stateRef.current.authors,
                    [msg.user.id]: { name: msg.user.name, color: msg.user.color },
                  };
                  const nextState = { ...stateRef.current, authors: updatedAuthors };
                  stateRef.current = nextState;
                  setRoomState(nextState);
                  conn.send({
                    type: 'room:state',
                    state: nextState,
                    activeUsers: getPeerUsersList(),
                  } satisfies SyncMessage);
                }
                const list = getPeerUsersList();
                setActiveUsers(list);
                broadcastAsHost({ type: 'presence:list', activeUsers: list });
                return;
              }

              if ('clientOpId' in msg) {
                applyIncomingMutation(msg);
                broadcastAsHost(msg, conn.peer);
              }
            });

            conn.on('close', () => {
              hostConnsRef.current.delete(conn.peer);
              peerPresenceRef.current.delete(conn.peer);
              const list = getPeerUsersList();
              setActiveUsers(list);
              broadcastAsHost({ type: 'presence:list', activeUsers: list });
            });
          });
        });

        hostPeer.on('error', (err: { type?: string }) => {
          if (disposed) return;
          if (err?.type === 'unavailable-id') {
            connectAsGuest();
          } else if (!firebaseReadyRef.current) {
            setTransport('local');
          }
        });
      };

      tryClaimHost();
    };

    const connectWebSocket = () => {
      if (disposed) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${window.location.host}/ws?room=${encodeURIComponent(roomId)}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed) return;
        if (!firebaseReadyRef.current) setTransport('websocket');
        ws.send(
          JSON.stringify({
            type: 'room:join',
            roomId,
            user: { ...userRef.current, lastSeen: Date.now() },
          } satisfies SyncMessage)
        );
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as SyncMessage;
          if (msg.type === 'room:state') {
            if (!firebaseReadyRef.current) {
              setRoomState(msg.state);
              stateRef.current = msg.state;
            }
            setActiveUsers(msg.activeUsers);
          } else if (msg.type === 'presence:list') {
            setActiveUsers(msg.activeUsers);
          } else if ('clientOpId' in msg) {
            applyIncomingMutation(msg);
          }
        } catch {
          // Ignore malformed message
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (!disposed) {
          if (!firebaseReadyRef.current) setTransport('connecting');
          reconnectTimer = window.setTimeout(connectWebSocket, 1500);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    fetch('./api/health', { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error('No backend');
        return res.json();
      })
      .then((data) => {
        if (data?.ok) {
          connectWebSocket();
        } else {
          startP2PFallback();
        }
      })
      .catch(() => {
        startP2PFallback();
      });

    return () => {
      disposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      bc.close();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (peerRef.current) {
        try {
          peerRef.current.destroy();
        } catch {
          // ignore
        }
        peerRef.current = null;
      }
    };
  }, [roomId, applyIncomingMutation]);

  const sendMessage = useCallback((msg: SyncMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
    if (guestConnRef.current && guestConnRef.current.open) {
      try {
        guestConnRef.current.send(msg);
      } catch {
        // ignore
      }
    }
    for (const conn of hostConnsRef.current.values()) {
      if (conn.open) {
        try {
          conn.send(msg);
        } catch {
          // ignore
        }
      }
    }
    if (bcRef.current && 'clientOpId' in msg) {
      try {
        bcRef.current.postMessage(msg);
      } catch {
        // ignore
      }
    }
  }, []);

  const dispatchMutation = useCallback(
    (mutation: ClientMutation) => {
      seenOpsRef.current.add(mutation.clientOpId);
      setRoomState((prev) => {
        const next = applyMutation(prev, mutation);
        stateRef.current = next;
        const immediate =
          mutation.type !== 'cue:update' && mutation.type !== 'section:update';
        scheduleFirestoreSync(next, immediate);
        return next;
      });
      sendMessage(mutation);
    },
    [scheduleFirestoreSync, sendMessage]
  );

  const sendPresence = useCallback(
    (activeCueId: string | null, isTyping: boolean) => {
      const profile: AuthorProfile = {
        id: userRef.current.id,
        name: userRef.current.name,
        color: userRef.current.color,
        activeCueId,
        isTyping,
        lastSeen: Date.now(),
      };
      sendMessage({ type: 'presence:update', user: profile });
    },
    [sendMessage]
  );

  useEffect(() => {
    if (transport !== 'connecting') {
      sendPresence(null, false);
    }
  }, [user.name, user.color, transport, sendPresence]);

  return {
    roomState,
    activeUsers,
    transport: firebaseReady ? 'firebase' : transport,
    firebaseUser,
    firebaseReady,
    shareToken,
    cloudError,
    cloudSaving,
    signInWithGoogle,
    signOutGoogle,
    dispatchMutation,
    sendPresence,
  };
}
