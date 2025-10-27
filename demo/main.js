import { Sender, Receiver } from '../src/index.js';
import { LocalDriver } from './driver/local.js';
import { NatsDriver } from './driver/nats.js';
import { createApp } from './ui.js';

const setupConference = async (app) => {
  let driver;
  if (app.dataset.driver === 'local') {
    driver = new LocalDriver();
  }
  else if (app.dataset.driver === 'nats') {
    driver = new NatsDriver();
  }
  else {
    throw new Error(`Unknown method: ${app.dataset.driver}`);
  }

  const receiver = new Receiver({ driver });
  const dataSender = new Sender({ driver });
  const cameraSender = new Sender({ driver, audioBitrate: 16, videoBitrate: 128 });
  const screenSender = new Sender({ driver, videoBitrate: 128 });

  receiver.addEventListener('stream', (e) => {
    const { id, stream, state } = e.detail;
    const { nickname = 'Guest', pid, audio, video, source } = state || {};
    app.appendItem(id, pid, { stream, source, nickname, audioEnabled: audio, videoEnabled: video });
  });

  receiver.addEventListener('channel', (e) => {
    const { id, state } = e.detail;
    const { nickname = 'Guest', pid } = state || {};
    app.appendItem(id, pid, { nickname });
  });

  receiver.addEventListener('dispose', (e) => {
    const { id } = e.detail;
    app.removeItem(id);
  });

  receiver.addEventListener('message', (e) => {
    const { message, state } = e.detail;
    const { nickname = 'Guest' } = state || {};
    app.appendMessage(message, nickname);
  });

  receiver.addEventListener('sync', (e) => {
    const { id, state } = e.detail;
    const { audio, video } = state || {};
    app.updateItem(id, { audio, video });
  });

  await driver.open(location.href);

  receiver.start({ room: app.dataset.room });
  dataSender.start({
    room: app.dataset.room,
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
      audioEnabled: !!audioEnabled,
      videoEnabled: !!videoEnabled,
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
      sender.sync({ audio: isAudioEnabled, video: isVideoEnabled }, true);
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
      videoEnabled: true,
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
