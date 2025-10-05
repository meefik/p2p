function createGrid() {
  const grid = document.createElement('div');
  grid.className = 'grid';

  grid.resize = () => {
    const n = grid.childElementCount;
    if (n === 0) {
      grid.style.setProperty('--rows', 1);
      grid.style.setProperty('--cols', 1);
      return;
    }

    const aspectRatio = 16 / 9;
    const cw = grid.clientWidth || window.innerWidth;
    const ch = grid.clientHeight || window.innerHeight;

    let best = { cols: 1, rows: n, score: -Infinity };

    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const cellW = cw / cols;
      const cellH = ch / rows;

      const tileW = Math.min(cellW, cellH * aspectRatio);
      const tileH = tileW / aspectRatio;

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

  grid.appendItem = (id, pid, options) => {
    const {
      stream,
      source,
      muted = false,
      mirror = false,
      nickname,
      audioEnabled,
      videoEnabled,
    } = options || {};

    const parent = grid.querySelector(`div[data-id="${pid}"]`) || document.createElement('div');
    parent.dataset.id = pid;
    if (nickname) {
      parent.dataset.name = nickname;
    }

    if (stream) {
      const video = parent.querySelector(`video[data-id="${id}"]`) || document.createElement('video');
      video.dataset.id = id;
      video.autoplay = true;
      video.muted = muted;
      video.playsInline = true;
      video.oncontextmenu = e => e.preventDefault();
      video.onclick = () => {
        if (video.dataset.expanded) {
          delete video.dataset.expanded;
        }
        else {
          video.dataset.expanded = 'true';
        }
      };
      if (source) video.dataset.source = source;
      if (mirror) video.dataset.mirror = true;
      if (typeof audioEnabled === 'boolean') {
        video.dataset.audio = audioEnabled;
      }
      if (typeof videoEnabled === 'boolean') {
        video.dataset.video = videoEnabled;
      }

      parent.appendChild(video);
      video.srcObject = stream;
      video.play();
    }
    else {
      const stub = parent.querySelector(`div[data-id="${id}"]`) || document.createElement('div');
      stub.dataset.id = id;
      parent.appendChild(stub);
    }

    grid.appendChild(parent);
    grid.resize();
  };

  grid.removeItem = (id) => {
    if (!id) return;

    const item = grid.querySelector(`[data-id="${id}"]`);
    if (item) {
      const parent = item.parentElement;
      item.remove();
      if (parent !== grid && !parent.childElementCount) {
        parent.remove();
      }
      grid.resize();
    }
  };

  grid.updateItem = (id, options) => {
    if (!id) return;

    const item = grid.querySelector(`[data-id="${id}"]`);
    if (item) {
      for (const option in options) {
        const value = options[option];
        if (typeof value !== 'undefined') {
          item.dataset[option] = value;
        }
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

  chat.appendMessage = (message, nickname) => {
    chat.hidden = false;
    toolbar.toggleChat(true);

    const div = document.createElement('div');
    div.className = 'message';
    div.textContent = message;
    if (nickname) {
      div.dataset.name = nickname;
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

function createDialog({ nickname, driver, onSubmit }) {
  const dialog = document.createElement('form');
  dialog.className = 'dialog';

  const container = document.createElement('div');

  const label1 = document.createElement('label');
  label1.textContent = 'Your name:';
  const nicknameInput = document.createElement('input');
  nicknameInput.name = 'nickname';
  nicknameInput.value = nickname || '';
  label1.appendChild(nicknameInput);
  container.appendChild(label1);

  const label2 = document.createElement('label');
  label2.textContent = 'Signaling driver:';
  const driverSelect = document.createElement('select');
  driverSelect.name = 'driver';
  const option1 = document.createElement('option');
  option1.value = 'local';
  option1.selected = driver === 'local';
  option1.textContent = 'LocalStorage';
  driverSelect.appendChild(option1);
  const option2 = document.createElement('option');
  option2.value = 'nats';
  option2.selected = driver === 'nats';
  option2.textContent = 'NATS';
  driverSelect.appendChild(option2);
  label2.appendChild(driverSelect);
  container.appendChild(label2);

  const button = document.createElement('button');
  button.textContent = 'JOIN';
  button.type = 'submit';
  container.appendChild(button);
  dialog.appendChild(container);

  dialog.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(dialog);
    const nickname = fd.get('nickname');
    const driver = fd.get('driver');
    if (!nickname || !driver) return;
    button.disabled = true;
    try {
      await onSubmit({ nickname, driver });
    }
    finally {
      button.disabled = false;
    }
  };

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
    nickname: localStorage.getItem('nickname') || 'Guest',
    driver: localStorage.getItem('driver') || 'local',
    onSubmit: async ({ driver, nickname }) => {
      localStorage.setItem('nickname', nickname);
      localStorage.setItem('driver', driver);

      container.appendChild(grid);
      container.appendChild(chat);
      container.appendChild(toolbar);
      dialog.remove();

      const hash = location.hash.slice(1);
      const room = hash || Math.random().toString(36).slice(2, 10);
      if (!hash) location.hash = `#${room}`;

      container.dataset.id = Math.random().toString(36).slice(2, 10);
      container.dataset.room = room;
      container.dataset.driver = driver;
      container.dataset.nickname = nickname;

      onJoin(container);
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
