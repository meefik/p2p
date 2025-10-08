export interface Driver {
  on(namespace: string[], handler: (message: any) => void): void;
  off(namespace: string[], handler: (message: any) => void): void;
  emit(namespace: string[], message: any): void;
}

export interface SenderConfig {
  driver: Driver;
  iceServers?: RTCIceServer[];
  verify?: (id: string, credentials: any) => boolean;
  connectionTimeout?: number;
  queueSize?: number;
  audioBitrate?: number;
  videoBitrate?: number;
  audioCodecs?: string[];
  videoCodecs?: string[];
}

export interface SenderStartOptions {
  room: string;
  stream?: MediaStream;
  state?: object;
  dataChannel?: boolean;
}

export declare class Sender extends EventTarget {
  constructor(config: SenderConfig);

  start(options?: SenderStartOptions): void;
  stop(): void;
  send(data: string | Blob | ArrayBuffer | ArrayBufferView, id?: string): void;
  sync(state: object, merge?: boolean): void;
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

export declare class Receiver extends EventTarget {
  constructor(config: ReceiverConfig);

  start(options?: ReceiverStartOptions): void;
  stop(): void;
}
