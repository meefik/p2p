import { Sender, Receiver } from '../src/index.js';
import { LocalDriver } from './driver/local.js';
import { NatsDriver } from './driver/nats.js';
import { createApp } from './ui.js';

const setupConference = async ({ method, room, username }) => {
  let driver;
  if (method === 'local') {
    driver = new LocalDriver();
  }
  else if (method === 'nats') {
    driver = new NatsDriver({ secret: location.origin });
  }
  else {
    throw new Error('Unknown method: ' + method);
  }
  const receiver = new Receiver({ driver });
  const dataSender = new Sender({ driver });
  const cameraSender = new Sender({ driver });
  const screenSender = new Sender({ driver });

  receiver.addEventListener('dispose', (e) => {
    const { id } = e.detail;
    app.removeItem(id);
  });

  receiver.addEventListener('message', (e) => {
    const { message, metadata } = e.detail;
    const { username = 'Guest' } = metadata || {};
    app.appendMessage(message, username);
  });

  receiver.addEventListener('stream', (e) => {
    const { id, stream, audioEnabled, videoEnabled, metadata } = e.detail;
    const { username } = metadata || {};
    app.appendItem(id, { stream, audioEnabled, videoEnabled, username });
  });

  receiver.addEventListener('change', (e) => {
    const { id, audioEnabled, videoEnabled } = e.detail;
    app.updateItem(id, { audioEnabled, videoEnabled });
  });

  await driver.open();
  receiver.start({ room });
  dataSender.start({ room, metadata: { username } });

  return { dataSender, cameraSender, screenSender };
};

const captureCamera = async (options) => {
  const {
    app,
    sender,
    stream,
    audioEnabled = sender.audioEnabled,
    videoEnabled = sender.videoEnabled,
  } = options || {};

  if (!stream?.active && (audioEnabled || videoEnabled)) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true,
    });
    sender.start({
      stream,
      room: app.getRoomName(),
      metadata: { username: app.getUserName() },
      audioEnabled: !!audioEnabled,
      videoEnabled: !!videoEnabled,
    });
    app.appendItem(stream.id, {
      stream,
      muted: true,
      mirror: true,
      audioEnabled: !!audioEnabled,
      videoEnabled: !!videoEnabled,
      username: app.getUserName(),
    });
    return stream;
  }
  else if (stream) {
    if (!audioEnabled && !videoEnabled) {
      sender.stop();
      app.removeItem(stream.id);
      stream.getTracks().forEach(track => track.stop());
      return null;
    }
    else {
      sender.audioEnabled = audioEnabled;
      sender.videoEnabled = videoEnabled;
      app.updateItem(stream.id, { audioEnabled, videoEnabled });
      return stream;
    }
  }
  return null;
};

const captureScreen = async (options) => {
  const { app, sender, stream, videoEnabled } = options || {};

  if (!stream?.active && videoEnabled) {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
    });
    sender.start({
      stream,
      room: app.getRoomName(),
      metadata: { username: app.getUserName() },
    });
    app.appendItem(stream.id, {
      stream,
      muted: true,
      videoEnabled: true,
      username: app.getUserName(),
    });
    return stream;
  }
  else if (stream) {
    sender.stop();
    app.removeItem(stream.id);
    stream.getTracks().forEach(track => track.stop());
    return null;
  }
};

let senders, cameraStream, screenStream;

const app = createApp({
  async onJoin({ method, room, username }) {
    senders = await setupConference({ method, room, username });
  },
  async onMicrophone(enabled) {
    const stream = await captureCamera({
      app,
      stream: cameraStream,
      sender: senders.cameraSender,
      audioEnabled: enabled,
    });
    cameraStream = stream;
  },
  async onCamera(enabled) {
    const stream = await captureCamera({
      app,
      stream: cameraStream,
      sender: senders.cameraSender,
      videoEnabled: enabled,
    });
    cameraStream = stream;
  },
  async onScreen(enabled) {
    const stream = await captureScreen({
      app,
      stream: screenStream,
      sender: senders.screenSender,
      videoEnabled: enabled,
    });
    screenStream = stream;
  },
  async onMessage(message) {
    senders.dataSender.send(message);
  },
});

document.body.appendChild(app);
