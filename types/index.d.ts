export interface Driver {
  on(namespace: string[], handler: (message: any) => void): void;
  off(namespace: string[], handler: (message: any) => void): void;
  emit(namespace: string[], message: any): void;
}

export interface SenderConfig {
  driver: Driver;
  iceServers?: RTCIceServer[];
  audioBitrate?: number;
  videoBitrate?: number;
  audioCodecs?: string[];
  videoCodecs?: string[];
}

export interface SenderStartOptions {
  stream?: MediaStream;
  room?: string;
  state?: object;
  dataChannel?: boolean;
}

export declare class Sender extends EventTarget {
  constructor(config: SenderConfig);

  start(options?: SenderStartOptions): void;
  stop(): void;
  send(data: string | Blob | ArrayBuffer | ArrayBufferView): void;
  sync(state: object, merge?: boolean): void;
}

export interface ReceiverConfig {
  driver: Driver;
  iceServers?: RTCIceServer[];
  timeout?: number;
  attempts?: number;
}

export interface ReceiverStartOptions {
  room?: string;
}

export declare class Receiver extends EventTarget {
  constructor(config: ReceiverConfig);

  start(options?: ReceiverStartOptions): void;
  stop(): void;
}
