import { Sender, Receiver } from '../src/index.js';
import { createApp } from './ui.js';

const DRIVERS_LIST = ['local', 'nats'];

const setupConference = async (app) => {
  let driver;
  if (app.dataset.driver === 'local') {
    const { LocalDriver } = await import('./driver/local.js');
    driver = new LocalDriver();
  }
  else if (app.dataset.driver === 'nats') {
    const { NatsDriver } = await import ('./driver/nats.js');
    driver = new NatsDriver();
  }
  else {
    throw new Error(`Unknown driver: ${app.dataset.driver}`);
  }

  const receiver = new Receiver({ driver });
  const dataSender = new Sender({ driver });
  const cameraSender = new Sender({ driver, audioBitrate: 16, videoBitrate: 128 });
  const screenSender = new Sender({ driver, videoBitrate: 128 });

  receiver.addEventListener('stream', (e) => {
    const { id, stream, state } = e.detail;
    const { pid, audio, video, source } = state || {};
    app.appendItem(id, pid, { stream, source, audio, video });
  });

  receiver.addEventListener('sync', (e) => {
    const { id, state } = e.detail;
    const { audio, video } = state || {};
    app.updateItem(id, { audio, video });
  });

  receiver.addEventListener('channel:open', (e) => {
    const { id, state } = e.detail;
    const { nickname = 'Guest', pid } = state || {};
    app.appendItem(id, pid, { nickname });
  });

  receiver.addEventListener('channel:message', (e) => {
    const { data, state } = e.detail;
    const { nickname = 'Guest' } = state || {};
    app.appendMessage(data, nickname);
  });

  receiver.addEventListener('dispose', (e) => {
    const { id } = e.detail;
    app.removeItem(id);
  });

  await driver.open(app.dataset.room);

  receiver.start({ room: app.dataset.room });
  dataSender.start({
    room: app.dataset.room,
    channels: { chat: { ordered: true } },
    state: { nickname: app.dataset.nickname, pid: app.dataset.id },
  });

  app.appendItem(dataSender.id, app.dataset.id, { nickname: app.dataset.nickname });

  return { dataSender, cameraSender, screenSender };
};

const captureCamera = async (options) => {
  const {
    app,
    sender,
    stream,
    audioEnabled,
    videoEnabled,
  } = options || {};

  if (!stream && (audioEnabled || videoEnabled)) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true,
    });
    stream.getAudioTracks().forEach(track => (track.enabled = !!audioEnabled));
    stream.getVideoTracks().forEach(track => (track.enabled = !!videoEnabled));
    sender.start({
      stream,
      room: app.dataset.room,
      state: { pid: app.dataset.id, source: 'camera', audio: !!audioEnabled, video: !!videoEnabled },
    });
    app.appendItem(sender.id, app.dataset.id, {
      stream,
      source: 'camera',
      muted: true,
      mirror: true,
      audio: !!audioEnabled,
      video: !!videoEnabled,
    });
    return stream;
  }
  else if (stream) {
    if (typeof audioEnabled !== 'undefined') {
      stream.getAudioTracks().forEach(track => (track.enabled = !!audioEnabled));
    }
    if (typeof videoEnabled !== 'undefined') {
      stream.getVideoTracks().forEach(track => (track.enabled = !!videoEnabled));
    }
    const isAudioEnabled = stream.getAudioTracks().some(track => track.enabled);
    const isVideoEnabled = stream.getVideoTracks().some(track => track.enabled);
    if (!isAudioEnabled && !isVideoEnabled) {
      app.removeItem(sender.id);
      sender.stop();
      stream.getTracks().forEach(track => track.stop());
      return null;
    }
    else {
      sender.sync({ audio: isAudioEnabled, video: isVideoEnabled }, { merge: true });
      app.updateItem(sender.id, { audio: isAudioEnabled, video: isVideoEnabled });
      return stream;
    }
  }
  return null;
};

const captureScreen = async (options) => {
  const {
    app,
    sender,
    stream,
    videoEnabled,
  } = options || {};

  if (!stream && videoEnabled) {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
    });
    sender.start({
      stream,
      room: app.dataset.room,
      state: { pid: app.dataset.id, source: 'screen', video: true },
    });
    app.appendItem(sender.id, app.dataset.id, {
      stream,
      source: 'screen',
      muted: true,
      video: true,
    });
    return stream;
  }
  else if (stream) {
    app.removeItem(sender.id);
    sender.stop();
    stream.getTracks().forEach(track => track.stop());
    return null;
  }
};

let senders, cameraStream, screenStream;

const app = createApp({
  driversList: DRIVERS_LIST,
  async onJoin(app) {
    senders = await setupConference(app);
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
