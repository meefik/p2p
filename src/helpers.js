/**
 * Generates a RFC4122 v4 (random) UUID.
 *
 * @return {string} UUID
 */
export function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Default STUN server for ICE.
 */
export const defaultIceServers = [{ urls: 'stun:stun.l.google.com:19302' }];

/**
 * Sets the bitrate for audio and video tracks in a peer connection.
 * Supported browsers: Chrome 68+, Firefox 64+, Safari 11+
 *
 * @param {RTCPeerConnection} peerConnection - The peer connection.
 * @param {number} [audioBitrate] - Audio bitrate in kbps.
 * @param {number} [videoBitrate] - Video bitrate in kbps.
 */
export function setPeerConnectionBitrate(peerConnection, audioBitrate, videoBitrate) {
  if (
    typeof peerConnection?.getSenders === 'function'
    && 'RTCRtpSender' in window
    && 'getParameters' in window.RTCRtpSender.prototype
    && 'setParameters' in window.RTCRtpSender.prototype
  ) {
    const bitrate = { audio: audioBitrate | 0, video: videoBitrate | 0 };
    peerConnection.getSenders().forEach((sender) => {
      const maxBitrate = bitrate[sender?.track.kind];
      if (!maxBitrate) return;
      const params = sender.getParameters();
      if (!params.encodings) params.encodings = [];
      for (let i = 0; i < params.encodings.length; i++) {
        const enc = params.encodings[i];
        if (enc) enc.maxBitrate = maxBitrate * 1000;
      }
      sender.setParameters(params);
    });
  }
}

/**
 * Sets the preferred codec for a specific media kind in a peer connection.
 * Supported browsers: Chrome 76+, Firefox 128+, Safari 13.1+
 *
 * @param {RTCPeerConnection} peerConnection - The peer connection to modify.
 * @param {string} preferredCodecMimeType - The MIME type of the preferred codec (e.g., 'video/VP8').
 * @param {string} kind - The media kind ('audio' or 'video').
 */
export function setPreferredCodecs(peerConnection, preferredCodecs, kind = 'video') {
  if (
    preferredCodecs?.length > 0
    && typeof peerConnection?.getTransceivers === 'function'
    && 'RTCRtpSender' in window
    && 'RTCRtpTransceiver' in window
    && 'getCapabilities' in window.RTCRtpSender
    && 'setCodecPreferences' in window.RTCRtpTransceiver.prototype
  ) {
    const transceivers = peerConnection.getTransceivers().filter((transceiver) => {
      return transceiver?.sender?.track?.kind === kind;
    });
    if (!transceivers.length) return;

    const codecs = RTCRtpSender.getCapabilities(kind).codecs.filter((codec) => {
      return preferredCodecs.includes(codec.mimeType);
    });
    if (!codecs.length) return;

    codecs.sort((a, b) => {
      return preferredCodecs.indexOf(a.mimeType) - preferredCodecs.indexOf(b.mimeType);
    });

    transceivers.forEach((transceiver) => {
      transceiver.setCodecPreferences(codecs);
    });
  }
}
