# p2p

A tiny, signaling-agnostic library for building peer-to-peer WebRTC conferencing (media + data channels) with pluggable signaling drivers.

Key ideas:
- **Sender**: creates outgoing RTCPeerConnections, publishes a local MediaStream, and optionally opens data channels to receivers.
- **Receiver**: listens for offers, answers them, and exposes remote MediaStreams and incoming data messages.
- **Signaling driver**: any object implementing `on(namespace, handler)`, `off(namespace, handler)` and `emit(namespace, message)`. This keeps the library transport-agnostic (WebSocket, pub/sub, in-memory, etc).

Why use p2p:
- Minimal footprint and API surface for broadcasting a local stream and exchanging data.
- Easy to test locally with an in-memory driver; swap to WebSocket or other drivers for production.
- Handles ICE, offer/answer exchange, candidate buffering, and per-peer data channels.

## Quickstart

Install:
```sh
npm install p2p
```

Run the demo (clone the repo if needed):
```sh
npm run dev
```

Open <http://localhost:8000/demo/> in two browser tabs to see a simple video chat demo.

[![DEMO](https://img.youtube.com/vi/2W9C71-L8AE/0.jpg)](https://www.youtube.com/watch?v=2W9C71-L8AE)

## Basic usage

Minimal in-memory signaling driver (useful for local testing):
```js
// Minimal in-memory pub/sub driver
class MemoryDriver extends Map {
  constructor() { super(); }
  on(namespace, handler) {
    const k = namespace.join(':');
    if (!this.has(k)) this.set(k, new Set());
    this.get(k).add(handler);
  }
  off(namespace, handler) {
    const k = namespace.join(':');
    this.get(k)?.delete(handler);
  }
  emit(namespace, message) {
    const k = namespace.join(':');
    if (!this.has(k)) return;
    for (const h of this.get(k)) {
      try { h(message); } catch (e) { /* swallow errors */ }
    }
  }
}
```

Signaling namespaces (contract)
- Sender listens on: `['sender', room]` and `['sender', room, senderId]`
- Sender emits to: `['receiver', room]` and `['receiver', room, receiverId]`
- Receiver listens on: `['receiver', room]` and `['receiver', room, receiverId]`
- Receiver emits to: `['sender', room]` and `['sender', room, senderId]`

Message types
- `invoke` — discovery / request to connect (contains id, optional credentials)
- `offer` — sender -> receiver with SDP offer and state
- `answer` — receiver -> sender with SDP answer
- `candidate` — ICE candidate exchange
- `dispose` — end/tear-down

Receiver — listen for senders and attach incoming streams:
```js
import { Receiver } from 'p2p';

const driver = new MemoryDriver();
const receiver = new Receiver({ driver });

receiver.addEventListener('stream', (e) => {
  const { id, stream, state } = e.detail;
  const video = document.createElement('video');
  video.autoplay = true;
  video.srcObject = stream;
  video.dataset.muted = state.muted;
  document.body.appendChild(video);
});

receiver.addEventListener('channel:message', (e) => {
  const { id, data } = e.detail;
  console.log('msg from', id, data);
});

receiver.start({ room: 'demo-room' });
// receiver.stop();
```

Sender — capture local media, broadcast, and send messages:
```js
import { Sender } from 'p2p';

const driver = new MemoryDriver();
const sender = new Sender({ driver });

sender.addEventListener('connect', (e) => {
  const { id } = e.detail;
  console.log('peer connected', id);
  sender.send('hello', { peer: id, channel: 'chat' });
});

navigator.mediaDevices.getUserMedia({ audio: true, video: true })
  .then((stream) => {
    sender.start({
      room: 'demo-room',
      stream,
      state: { muted: false },
      channels: { chat: { ordered: true } },
    });
  });
```

## API summary

Sender:
- constructor(config: { driver, iceServers?, verify?, connectionTimeout?, audioBitrate?, videoBitrate? })
- start({ room?, stream?, metadata?, channels? })
- stop()

Events: `connect`, `dispose`, `error`, `channel:open`, `channel:close`, `channel:error`, `channel:message`

Receiver:
- constructor(config: { driver, iceServers?, connectionTimeout?, pingInterval?, pingAttempts? })
- start({ room?, credentials? })
- stop()

Events: `stream`, `connect`, `dispose`, `channel:open`, `channel:close`, `channel:error`, `channel:message`

## Troubleshooting & tips

- Browser permissions: getUserMedia requires secure context (https or localhost) and user consent.
- TURN servers: include TURN servers in iceServers for reliable connectivity across NATs.
- Candidate buffering: the library buffers ICE candidates received before a connection is created.
- Bitrate and codec hints: the library sets preferred codecs and bitrate where supported; browsers may ignore hints.
- Debugging: use browser WebRTC internals and ICE/state events to diagnose connectivity issues.

## Security & verification

- Sender supports an optional verify(id, credentials) callback to accept/reject incoming invocations.
- If you need authentication/authorization, implement it in your signaling layer and/or verify callback.
- Always use secure signaling channels (e.g., WSS) to protect exchanged SDP and ICE candidates.
