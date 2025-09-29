function createGrid() {
  const grid = document.createElement('div');
  grid.className = 'grid';

  grid.resize = () => {
    const videos = grid.querySelectorAll('video');
    const n = videos.length;
    if (n === 0) {
      grid.style.setProperty('--rows', 1);
      grid.style.setProperty('--cols', 1);
      return;
    }

    const videoAspect = 16 / 9;
    const cw = grid.clientWidth || window.innerWidth;
    const ch = grid.clientHeight || window.innerHeight;

    let best = { cols: 1, rows: n, score: -Infinity };

    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const cellW = cw / cols;
      const cellH = ch / rows;

      const tileW = Math.min(cellW, cellH * videoAspect);
      const tileH = tileW / videoAspect;

      const totalArea = tileW * tileH * n;
      const empty = cols * rows - n;
      const score = totalArea - empty * tileW * tileH * 0.02;

      const diff = score - best.score;
      if (diff > 1e-6 || (Math.abs(diff) < 1e-6 && cols * rows < best.cols * best.rows)) {
        best = { cols, rows, score };
      }
    }

    grid.style.setProperty('--rows', best.rows);
    grid.style.setProperty('--cols', best.cols);
  };

  grid.appendItem = (id, options) => {
    const { stream, muted = false, mirror = false, username, audioEnabled, videoEnabled } = options || {};

    const el = grid.querySelector(`div[data-id="${id}"]`);
    if (el) return;

    const div = document.createElement('div');
    div.dataset.id = id;
    if (username) {
      div.dataset.name = username;
    }
    if (typeof audioEnabled === 'boolean') {
      div.dataset.audio = audioEnabled;
    }
    if (typeof videoEnabled === 'boolean') {
      div.dataset.video = videoEnabled;
    }

    const video = document.createElement('video');
    video.autoplay = true;
    video.muted = muted;
    video.playsInline = true;
    video.oncontextmenu = e => e.preventDefault();
    video.onclick = () => video.play();
    if (mirror) video.dataset.mirror = true;

    div.appendChild(video);
    video.srcObject = stream;
    video.play();

    grid.appendChild(div);
    grid.resize();
  };

  grid.removeItem = (id) => {
    if (!id) return;

    const div = grid.querySelector(`div[data-id="${id}"]`);
    if (div) {
      grid.removeChild(div);
      grid.resize();
    }
  };

  grid.updateItem = (id, options) => {
    if (!id) return;

    const { username, audioEnabled, videoEnabled } = options || {};
    const div = grid.querySelector(`div[data-id="${id}"]`);
    if (div) {
      if (username) {
        div.dataset.name = username;
      }
      if (typeof audioEnabled === 'boolean') {
        div.dataset.audio = audioEnabled;
      }
      if (typeof videoEnabled === 'boolean') {
        div.dataset.video = videoEnabled;
      }
    }
  };

  return grid;
}

function createToolbar({ onMicrophone, onCamera, onScreen, onChat }) {
  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';

  const microphoneButton = document.createElement('button');
  microphoneButton.className = 'microphone_btn';
  microphoneButton.title = 'Microphone';
  microphoneButton.dataset.enabled = 'false';
  microphoneButton.onclick = async () => {
    const enabled = microphoneButton.dataset.enabled !== 'true';
    microphoneButton.disabled = true;
    try {
      if (onMicrophone) {
        await onMicrophone(enabled);
      }
      microphoneButton.dataset.enabled = enabled ? 'true' : 'false';
    }
    finally {
      microphoneButton.disabled = false;
    }
  };
  toolbar.appendChild(microphoneButton);

  const cameraButton = document.createElement('button');
  cameraButton.className = 'camera_btn';
  cameraButton.title = 'Camera';
  cameraButton.dataset.enabled = 'false';
  cameraButton.onclick = async () => {
    const enabled = cameraButton.dataset.enabled !== 'true';
    cameraButton.disabled = true;
    try {
      if (onCamera) {
        await onCamera(enabled);
      }
      cameraButton.dataset.enabled = enabled ? 'true' : 'false';
    }
    finally {
      cameraButton.disabled = false;
    }
  };
  toolbar.appendChild(cameraButton);

  const screenButton = document.createElement('button');
  screenButton.className = 'screen_btn';
  screenButton.title = 'Screen';
  screenButton.dataset.enabled = 'false';
  screenButton.onclick = async () => {
    const enabled = screenButton.dataset.enabled !== 'true';
    screenButton.disabled = true;
    try {
      if (onScreen) {
        await onScreen(enabled);
      }
      screenButton.dataset.enabled = enabled ? 'true' : 'false';
    }
    finally {
      screenButton.disabled = false;
    }
  };
  toolbar.appendChild(screenButton);

  const chatButton = document.createElement('button');
  chatButton.className = 'chat_btn';
  chatButton.title = 'Chat';
  chatButton.onclick = async () => {
    const enabled = chatButton.dataset.enabled !== 'true';
    chatButton.disabled = true;
    try {
      if (onChat) {
        await onChat(enabled);
      }
      chatButton.dataset.enabled = enabled ? 'true' : 'false';
    }
    finally {
      chatButton.disabled = false;
    }
  };
  toolbar.appendChild(chatButton);

  toolbar.toggleChat = (enabled) => {
    chatButton.dataset.enabled = enabled ? 'true' : 'false';
  };

  return toolbar;
}

function createError(message) {
  const error = document.createElement('div');
  error.className = 'error';
  error.textContent = message;
  return error;
}

function createChat({ toolbar, onMessage }) {
  const chat = document.createElement('div');
  chat.className = 'chat';
  chat.hidden = true;

  const messages = document.createElement('div');
  messages.className = 'messages';
  chat.appendChild(messages);

  const input = document.createElement('textarea');
  input.className = 'input';
  input.placeholder = 'Type your message...';
  input.onkeydown = async (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const message = input.value.trim();
      if (message) {
        input.disabled = true;
        try {
          if (onMessage) {
            await onMessage(message);
          }
          chat.appendMessage(message);
          input.value = '';
        }
        finally {
          requestAnimationFrame(() => input.focus());
          input.disabled = false;
        }
      }
    }
  };
  chat.appendChild(input);

  chat.appendMessage = (message, username) => {
    chat.hidden = false;
    toolbar.toggleChat(true);

    const div = document.createElement('div');
    div.className = 'message';
    div.textContent = message;
    if (username) {
      div.dataset.name = username;
    }
    div.dataset.time = new Date().toLocaleTimeString();
    messages.appendChild(div);
    requestAnimationFrame(() => {
      messages.scrollTop = messages.scrollHeight;
      input.focus();
    });
  };

  return chat;
}

function createDialog({ username, method, onSubmit }) {
  const dialog = document.createElement('div');
  dialog.className = 'dialog';

  const container = document.createElement('div');

  const label1 = document.createElement('label');
  label1.textContent = 'Enter your name:';
  const usernameInput = document.createElement('input');
  usernameInput.value = username || '';

  const label2 = document.createElement('label');
  label2.textContent = 'Driver:';
  const methodSelect = document.createElement('select');
  const option1 = document.createElement('option');
  option1.value = 'local';
  option1.selected = method === 'local';
  option1.textContent = 'LocalStorage';
  methodSelect.appendChild(option1);
  const option2 = document.createElement('option');
  option2.value = 'nats';
  option2.selected = method === 'nats';
  option2.textContent = 'NATS';
  methodSelect.appendChild(option2);

  const button = document.createElement('button');
  button.textContent = 'JOIN';
  button.onclick = async () => {
    if (!usernameInput.value) return;
    button.disabled = true;
    try {
      await onSubmit({
        username: usernameInput.value,
        method: methodSelect.value,
      });
    }
    finally {
      button.disabled = false;
    }
  };

  label1.appendChild(usernameInput);
  container.appendChild(label1);
  label2.appendChild(methodSelect);
  container.appendChild(label2);
  container.appendChild(button);
  dialog.appendChild(container);

  return dialog;
}

export function createApp({ onMicrophone, onCamera, onScreen, onMessage, onJoin } = {}) {
  const container = document.createElement('div');
  container.className = 'container';

  const grid = createGrid();

  const toolbar = createToolbar({
    onMicrophone,
    onCamera,
    onScreen,
    onChat: async (enabled) => {
      chat.hidden = !enabled;
    },
  });

  const chat = createChat({
    toolbar,
    onMessage,
  });

  const dialog = createDialog({
    username: localStorage.getItem('username') || 'Guest',
    method: localStorage.getItem('method') || 'local',
    onSubmit: async ({ method, username }) => {
      localStorage.setItem('username', username);
      localStorage.setItem('method', method);
      container.appendChild(grid);
      container.appendChild(chat);
      container.appendChild(toolbar);
      dialog.remove();

      const hash = location.hash.slice(1);
      const room = hash || Math.random().toString(36).slice(2, 10);
      if (!hash) location.hash = `#${room}`;

      onJoin({ method, room, username });

      container.getUserName = () => username;
      container.getRoomName = () => room;
    },
  });

  container.appendItem = (...args) => grid.appendItem(...args);
  container.updateItem = (...args) => grid.updateItem(...args);
  container.removeItem = (...args) => grid.removeItem(...args);
  container.appendMessage = (...args) => chat.appendMessage(...args);
  container.showError = (message, duration = 5000) => {
    const err = createError(message);
    container.appendChild(err);
    setTimeout(() => container.removeChild(err), duration);
  };

  container.appendChild(dialog);

  window.addEventListener('resize', () => grid.resize());

  return container;
}
