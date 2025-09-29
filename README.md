# p2p

A lightweight library for creating peer-to-peer WebRTC conferencing with custom signaling drivers.

## Overview

The library provides two small building blocks:

- `Sender` — creates outgoing PeerConnections, publishes local MediaStream and optional DataChannels, and sends offers to remote receivers through a signaling driver.
- `Receiver` — listens for offers, answers them, and exposes remote streams and incoming data messages.

The library is signaling-agnostic: you must provide a driver with `on(namespace, handler)`, `off(namespace, handler)` and `emit(namespace, message)` semantics. This allows usage with WebSocket, Pub/Sub services (such as NATS), server-side event buses, or a simple in-memory driver for prototypes.

## How to use

Install the module:

```sh
npm install p2p
```

Run demo/watch:

```sh
npm run dev
```

Open <http://localhost:8000/demo/> in two browser tabs to see it in action.

[![DEMO](https://img.youtube.com/vi/2W9C71-L8AE/0.jpg)](https://www.youtube.com/watch?v=2W9C71-L8AE)

## Usage summary

- Provide a signaling driver (see example below).
- Create and start a Sender if you want to broadcast a local MediaStream.
- Create and start a Receiver to discover and accept remote streams.
- Listen to events on Sender/Receiver to react to connections, errors, remote streams, and data messages.

## Signaling driver example (in-memory)

This tiny driver is useful for local testing and examples. Replace it with your WebSocket or other signaling implementation in real apps.

```javascript
// Minimal in-memory pub/sub driver
class MemoryDriver {
  constructor() {
    this._handlers = new Map();
  }
  on(namespace, handler) {
    const k = [].concat(namespace).join('.');
    if (!this._handlers.has(k)) {
      this._handlers.set(k, new Set());
    }
    this._handlers.get(k).add(handler);
  }
  off(namespace, handler) {
    const k = [].concat(namespace).join('.');
    this._handlers.get(k)?.delete(handler);
  }
  emit(namespace, msg) {
    const k = [].concat(namespace).join('.');
    const hs = this._handlers.get(k);
    if (hs) {
      for (const h of hs) {
        try { h(msg); } catch (e) { /* swallow */ }
      }
    }
  }
}
```

## Receiving streams and messages

Receiver listens for senders in a room and will respond to offers. It emits 'stream' when remote media arrives and 'message' for data channel messages.

```javascript
import { Receiver } from 'p2p';

const driver = new MemoryDriver();
const receiver = new Receiver({ driver });

receiver.addEventListener('stream', (e) => {
  const { id, stream, metadata } = e.detail;
  console.log('remote stream from', id, metadata);

  // attach to a video element
  const video = document.createElement('video');
  video.autoplay = true;
  video.srcObject = stream;
  document.body.appendChild(video);
});

receiver.addEventListener('message', (e) => {
  const { id, message, metadata } = e.detail;
  console.log('message from', id, message, metadata);
});

receiver.addEventListener('connect', (e) => {
  const { id } = e.detail;
  console.log('peer connected', id);
});

// start listening in the same room as the sender
receiver.start({ room: 'demo-room' });

// stop when done
// receiver.stop();
```

## Broadcasting local webcam

Sender sends an offer to receivers in a room and publishes your local stream.

```javascript
import { Sender } from 'p2p';

// prepare local stream (browser)
const stream = await navigator.mediaDevices.getUserMedia({
  audio: true,
  video: true
});

// create sender
const sender = new Sender({ driver });

sender.addEventListener('open', (e) => {
  const { id } = e.detail;
  console.log('data channel opened', id);
  // send text data to the connected receiver
  sender.send('Hello from sender!');
});
sender.addEventListener('error', (e) => {
  const { id, error } = e.detail;
  console.error('sender error', id, error);
});

// start sender, provide local stream and room name
sender.start({
  stream,
  room: 'demo-room',
  metadata: { name: 'Alice' },
  dataChannel: true, // create data channels for each receiver
});

// toggle audio/video at runtime
sender.audioEnabled = false;
sender.videoEnabled = true;

// to stop and close everything:
// sender.stop();
```

## API details

### Driver

A class or object that implements the pub/sub signaling protocol.

**Methods**

- `on(namespace: Array<string>, handler: (message: any) => void): void` — Subscribe a handler to the specified namespace; the handler will be called with the message payload when messages are emitted to that namespace.
- `off(namespace: Array<string>, handler: (message: any) => void): void` — Unsubscribe a previously registered handler from the given namespace so it no longer receives messages.
- `emit(namespace: Array<string>, message: any): void` — Publish a message to the specified namespace; all handlers subscribed to that namespace will be called with the message payload.

**Signaling expectations**

Namespaces used by the library:
- Sender listens on: `['sender', room]` and `['sender', room, senderId]`
- Sender emits to: `['receiver', room]` and `['receiver', room, receiverId]`
- Receiver listens on: `['receiver', room]` and `['receiver', room, receiverId]`
- Receiver emits to: `['sender', room]` and `['sender', room, senderId]`

Messages include type fields:
- `invoke` — request to connect (id only)
- `offer` — sender -> receiver with SDP offer and metadata
- `answer` — receiver -> sender with SDP answer
- `candidate` — ICE candidate exchange
- `change` — media toggles (audioEnabled/videoEnabled)
- `dispose` — tear down

### Sender

A class creates outgoing PeerConnections, publishes local MediaStream and optional DataChannels, and sends offers to remote receivers through a signaling driver.

**Constructor**

- `driver`: `object` — Signaling driver implementing `on(namespace, handler)`, `off(namespace, handler)`, `emit(namespace, message)`.
- `iceServers`: `Array<RTCIceServer>` — RTCPeerConnection `iceServers` for NAT traversal.
- `audioBitrate`: `number` — Target audio bitrate (kbps).
- `videoBitrate`: `number` — Target video bitrate (kbps).
- `audioCodecs`: `Array<string>` — Preferred audio codec lists (in order).
- `videoCodecs`: `Array<string>` — Preferred video codec lists (in order).

**Methods**

- `start(options: object): void` — Begin broadcasting. Options:
  - `stream: MediaStream` — Local media to publish.
  - `room: string` — Room name to signal into (`default` if omitted).
  - `metadata: any` — Arbitrary metadata sent with the offer.
  - `dataChannel: boolean` — Create per-peer DataChannels when `true` (or when no `stream`).
  - `audioEnabled: boolean` — Initial audio track enabled flag.
  - `videoEnabled: boolean` —  Initial video track enabled flag.
- `stop(): void` — Close all peer connections, data channels, and stop broadcasting.
- `send(data: any): void` — Send `data` over all open data channels to connected receivers.

**Events**

- `connect`: `{ detail: { id: string, peer: RTCPeerConnection } }` — New peer connection established.
- `open`: `{ detail: { id: string, channel: RTCDataChannel } }` — DataChannel opened for peer `id`.
- `close`: `{ detail: { id: string, channel: RTCDataChannel } }` — DataChannel closed for peer `id`.
- `dispose`: `{ detail: { id: string, peer: RTCPeerConnection } }` — Peer connection torn down.
- `error`: `{ detail: { id: string, error: Error } }` — Error related to peer `id` (or general sender error).

### Receiver

A class listens for offers, answers them, and exposes remote streams and incoming data messages.

**Constructor**

- `driver`: `object` — Signaling driver with `on/off/emit`.
- `iceServers`: `Array<RTCIceServer>` — Configuration of STUN or TURN servers.
- `timeout`: `number` — Time to wait for responses / attempts (seconds).
- `attempts`: `number` — Number of retry attempts for offers/answers.

**Methods**

- `start(options: object): void` — Begin listening for senders in `room` and respond to offers.
  - `room: string` — Room name to signal into (`default` if omitted).
- `stop(): void` — Close peers and stop listening.

**Events**

- `stream`: `{ id: string, stream: MediaStream, audioEnabled: boolean, videoEnabled: boolean, metadata: any }` — Remote MediaStream received from peer `id`.
- `message`: `{ id: string, message: any, metadata: any }` — DataChannel message from peer `id`.
- `change`: `{ id: string, audioEnabled: boolean, videoEnabled: boolean }` — Remote toggled audio/video.
- `connect`:  `{ id: string, peer: RTCPeerConnection }` — Peer connection established.
- `open`: `{ id: string, channel: RTCDataChannel }` — Data channel opened.
- `close`: `{ id: string, channel: RTCDataChannel }` — Data channel closed.
- `dispose`: `{ id: string, peer: RTCPeerConnection }` — Peer connection disposed.
- `error`: `{ id: string, error: Error }` — Error related to peer `id` (or general receiver error).

## Notes and tips

- For production, plug the driver to a server-backed signaling channel (WebSocket).
- Provide TURN servers in iceServers for NAT traversal in real-world deployments.
- The library sets preferred codecs and bitrate where supported — these are hints and may be ignored by browsers.
- Data channels are created per-peer and named by peer id.
