# p2p

A lightweight library for creating peer-to-peer WebRTC conferencing with custom signaling drivers.

## Overview

The library provides two small building blocks:

- `Sender` — creates outgoing PeerConnections, publishes local MediaStream and optional DataChannels, and sends offers to remote receivers through a signaling driver.
- `Receiver` — listens for offers, answers them, and exposes remote streams and incoming data messages.

The library is signaling-agnostic: you must provide a driver with `on(namespace, handler)`, `off(namespace, handler)` and `emit(namespace, data)` semantics. This allows usage with WebSocket, Pub/Sub services (such as NATS), server-side event buses, or a simple in-memory driver for prototypes.

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
class MemoryDriver extends Map {
  constructor() {
    super();
  }
  on(namespace, handler) {
    const k = namespace.join(':');
    if (!this.has(k)) {
      this.set(k, new Set());
    }
    this.get(k).add(handler);
  }
  off(namespace, handler) {
    const k = namespace.join(':');
    this.get(k)?.delete(handler);
  }
  emit(namespace, data) {
    const k = namespace.join(':');
    if (this.has(k)) {
      for (const h of this.get(k)) {
        try { h(data); } catch (e) { /* swallow */ }
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
  const { id, stream } = e.detail;
  console.log('stream received', id);

  // attach to a video element
  const video = document.createElement('video');
  video.autoplay = true;
  video.srcObject = stream;
  document.body.appendChild(video);
});

receiver.addEventListener('channel', (e) => {
  const { id } = e.detail;
  console.log('data channel opened', id);
});

receiver.addEventListener('message', (e) => {
  const { id, message } = e.detail;
  console.log('message received', id, message);
});

receiver.addEventListener('dispose', (e) => {
  const { id, error } = e.detail;
  console.log('peer disposed', id, error);
});

// start listening in the same room as the sender
receiver.start({ room: 'demo-room' });

// stop when done
// receiver.stop();
```

## Broadcasting webcam and sending messages

Sender sends an offer to receivers in a room and publishes your local stream.

```javascript
import { Sender } from 'p2p';

// create sender
const sender = new Sender({ driver });

sender.addEventListener('connect', (e) => {
  const { id } = e.detail;
  console.log('peer connected', id);
  // send text data to the connected receiver
  sender.send('Hello from sender!', id);
});

// prepare local stream (browser)
navigator.mediaDevices.getUserMedia({
  audio: true,
  video: true
}).then((stream) => {
  // start sender, provide local stream and room name
  sender.start({
    stream,
    room: 'demo-room',
    dataChannel: true, // create data channels for each receiver
  });
});

// to stop and close everything
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
- `sync` — state sync (such as audio/video enabled)
- `dispose` — tear down

### Sender

A class creates outgoing PeerConnections, publishes local MediaStream and optional DataChannels, and sends offers to remote receivers through a signaling driver.

**Constructor**

- `driver`: `object` — Signaling driver implementing `on(namespace, handler)`, `off(namespace, handler)`, `emit(namespace, message)`.
- `iceServers`: `Array<RTCIceServer>` — RTCPeerConnection `iceServers` for NAT traversal.
- `verify`: `(id: string, credentials: any) => boolean` — Optional function to verify incoming connection requests; should return `true` to accept or `false` to reject.
- `connectionTimeout`: `number` — Time in seconds to wait for PeerConnection to connect (30 by default).
- `queueSize`: `number` — Maximum number of messages to queue if no channels are connected (10 by default).
- `audioBitrate`: `number` — Target audio bitrate (kbps).
- `videoBitrate`: `number` — Target video bitrate (kbps).

**Methods**

- `start(options: object): void` — Begin broadcasting. Options:
  - `stream: MediaStream` — Local media to publish.
  - `room: string` — Room name to signal into (`default` if omitted).
  - `state: object` — Arbitrary state sent with the offer.
  - `dataChannel: boolean` — Create per-peer data channels when `true` (or when no `stream`).
- `stop(): void` — Close all peer connections, data channels, and stop broadcasting.
- `send(data: any, id?: string): void` — Send `data` over all open data channels to connected receivers.
- `sync(state: object, merge?: boolean): void` — Update and send `state` to all connected receivers.

**Events**

- `connect`: `{ id: string, peer: RTCPeerConnection }` — Peer connection established.
- `dispose`: `{ id: string, peer: RTCPeerConnection, error?: Error }` — Peer connection closed.
- `error`: `{ id: string, error: Error }` — Non-fatal error occurred.

### Receiver

A class listens for offers, answers them, and exposes remote streams and incoming data messages.

**Constructor**

- `driver`: `object` — Signaling driver with `on/off/emit`.
- `iceServers`: `Array<RTCIceServer>` — Configuration of STUN or TURN servers.
- `connectionTimeout`: `number` — Time in seconds to wait for PeerConnection to connect (30 by default).
- `pingInterval`: `number` — Ping interval in seconds to re-establish connections (30 by default).
- `pingAttempts`: `number` — Number of ping attempts after all peers are gone. (10 by default).

**Methods**

- `start(options: object): void` — Begin listening for senders in `room` and respond to offers.
  - `room: string` — Room name to signal into (`default` if omitted).
  - `credentials: any` — Optional credentials to identify/authorize the receiver.
- `stop(): void` — Close peers and stop listening.

**Events**

- `stream`: `{ id: string, stream: MediaStream, state: object }` — Remote MediaStream received from peer `id`.
- `message`: `{ id: string, message: any, state: object }` — Data channel message from peer `id`.
- `channel`: `{ id: string, channel: RTCDataChannel, state: object }` — Data channel established with peer `id`.
- `sync`: `{ id: string, state: object }` — Remote state changed (such as audio/video enabled).
- `connect`:  `{ id: string, peer: RTCPeerConnection, state: object }` — Peer connection established.
- `dispose`: `{ id: string, peer: RTCPeerConnection, state: object, error?: Error }` — Peer connection closed.
- `error`: `{ id: string, error: Error }` — Non-fatal error occurred.

## Notes and tips

- For production, plug the driver to a server-backed signaling channel (WebSocket).
- Provide TURN servers in iceServers for NAT traversal in real-world deployments.
- The library sets preferred codecs and bitrate where supported — these are hints and may be ignored by browsers.
- Data channels are created per-peer and named by peer id.
