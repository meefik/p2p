export interface Driver {
  on(namespace: string[], handler: (message: any) => void): void;
  off(namespace: string[], handler: (message: any) => void): void;
  emit(namespace: string[], message: any): void;
}

export interface ConnectEvent {
  id: string;
  peer: RTCPeerConnection;
  state: object;
}

export interface StreamEvent {
  id: string;
  peer: RTCPeerConnection;
  stream: MediaStream;
  state: object;
}

export interface DisposeEvent {
  id: string;
  peer: RTCPeerConnection;
  error?: Error;
  state: object;
}

export interface SyncEvent {
  id: string;
  peer: RTCPeerConnection;
  state: object;
}

export interface ErrorEvent {
  id: string;
  error: Error;
}

export interface ChannelOpenEvent {
  id: string;
  peer: RTCPeerConnection;
  channel: RTCDataChannel;
  state: object;
}

export interface ChannelCloseEvent {
  id: string;
  peer: RTCPeerConnection;
  channel: RTCDataChannel;
  state: object;
}

export interface ChannelErrorEvent {
  id: string;
  peer: RTCPeerConnection;
  channel: RTCDataChannel;
  error: Error;
  state: object;
}

export interface ChannelMessageEvent {
  id: string;
  peer: RTCPeerConnection;
  channel: RTCDataChannel;
  data: any;
}

export interface SenderConfig {
  driver: Driver;
  iceServers?: RTCIceServer[];
  verify?: (id: string, credentials: any) => boolean;
  connectionTimeout?: number;
  queueSize?: number;
  audioBitrate?: number;
  videoBitrate?: number;
}

export interface SenderStartOptions {
  room: string;
  stream?: MediaStream;
  state?: object;
  channels?: { [label: string]: object };
}

export interface SenderSendOptions {
  peer?: string;
  channel?: string;
}

export interface SenderSyncOptions {
  merge?: boolean;
}

export interface SenderEventMap {
  'connect': ConnectEvent;
  'dispose': DisposeEvent;
  'error': ErrorEvent;
  'channel:open': ChannelOpenEvent;
  'channel:close': ChannelCloseEvent;
  'channel:error': ChannelErrorEvent;
  'channel:message': ChannelMessageEvent;
}

export declare class Sender extends EventTarget {
  constructor(config: SenderConfig);

  start(options?: SenderStartOptions): void;
  stop(): void;
  send(data: any, options?: SenderSendOptions): void;
  sync(state: object, options?: SenderSyncOptions): void;

  addEventListener<K extends keyof SenderEventMap>(
    type: K,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ): void;

  removeEventListener<K extends keyof SenderEventMap>(
    type: K,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions
  ): void;
}

export interface ReceiverConfig {
  driver: Driver;
  iceServers?: RTCIceServer[];
  connectionTimeout?: number;
  pingInterval?: number;
  pingAttempts?: number;
}

export interface ReceiverStartOptions {
  room: string;
  credentials?: any;
}

export interface ReceiverEventMap {
  'connect': ConnectEvent;
  'stream': StreamEvent;
  'dispose': DisposeEvent;
  'sync': SyncEvent;
  'error': ErrorEvent;
  'channel:open': ChannelOpenEvent;
  'channel:close': ChannelCloseEvent;
  'channel:error': ChannelErrorEvent;
  'channel:message': ChannelMessageEvent;
}

export declare class Receiver extends EventTarget {
  constructor(config: ReceiverConfig);

  start(options?: ReceiverStartOptions): void;
  stop(): void;

  addEventListener<K extends keyof ReceiverEventMap>(
    type: K,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ): void;

  removeEventListener<K extends keyof ReceiverEventMap>(
    type: K,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions
  ): void;
}
