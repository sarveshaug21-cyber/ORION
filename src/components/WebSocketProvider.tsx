import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type ReadyState = typeof WebSocket.CONNECTING | typeof WebSocket.OPEN | typeof WebSocket.CLOSING | typeof WebSocket.CLOSED;

interface WebSocketContextValue {
  sendMessage: (message: Record<string, unknown>) => void;
  lastMessage: MessageEvent | null;
  readyState: ReadyState;
  reconnect: () => void;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

function resolveWsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return `${protocol}//${host}/ws`;
}

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const [lastMessage, setLastMessage] = useState<MessageEvent | null>(null);
  const [readyState, setReadyState] = useState<ReadyState>(WebSocket.CLOSED);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalClose = useRef(false);
  const attemptRef = useRef(0);

  const clearReconnect = () => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
  };

  const connect = useCallback(() => {
    clearReconnect();
    intentionalClose.current = false;

    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      if (
        wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING
      ) {
        wsRef.current.close();
      }
    }

    const ws = new WebSocket(resolveWsUrl());
    wsRef.current = ws;
    setReadyState(WebSocket.CONNECTING);

    ws.onopen = () => {
      attemptRef.current = 0;
      setReadyState(WebSocket.OPEN);
    };

    ws.onmessage = (event) => {
      setLastMessage(event);
    };

    ws.onerror = () => {
      setReadyState(ws.readyState as ReadyState);
    };

    ws.onclose = () => {
      setReadyState(WebSocket.CLOSED);
      if (intentionalClose.current) return;

      const attempt = attemptRef.current + 1;
      attemptRef.current = attempt;
      const delay = Math.min(1000 * 2 ** Math.min(attempt, 5), 15000);
      reconnectTimer.current = setTimeout(connect, delay);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      intentionalClose.current = true;
      clearReconnect();
      wsRef.current?.close();
    };
  }, [connect]);

  const sendMessage = useCallback((message: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket not connected; message dropped', message.type);
      return;
    }
    ws.send(JSON.stringify(message));
  }, []);

  const reconnect = useCallback(() => {
    attemptRef.current = 0;
    connect();
  }, [connect]);

  const value = useMemo(
    () => ({ sendMessage, lastMessage, readyState, reconnect }),
    [sendMessage, lastMessage, readyState, reconnect]
  );

  return <WebSocketContext.Provider value={value}>{children}</WebSocketContext.Provider>;
}

export function useWebSocket(): WebSocketContextValue {
  const ctx = useContext(WebSocketContext);
  if (!ctx) {
    throw new Error('useWebSocket must be used within WebSocketProvider');
  }
  return ctx;
}
