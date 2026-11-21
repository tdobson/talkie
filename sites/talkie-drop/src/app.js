// Drop or choose a .lottie file and play it in <talkie-player>. The bytes never leave the page.

const MAX_BYTES = 500 * 1024 * 1024;

const MESSAGES = {
  'invalid-film': 'That file is not a Talkie film, or it is damaged.',
  'unsupported-version': 'This film was made with a newer Talkie than this player understands.',
  'no-playable-audio': 'This browser cannot play the film’s narration.',
  network: 'The film could not be read.',
  'scene-failed': 'Part of the film could not be drawn.',
};

const drop = document.getElementById('drop');
const input = document.getElementById('file');
const stage = document.getElementById('stage');
const player = document.getElementById('player');
const nameEl = document.getElementById('name');
const errorEl = document.getElementById('error');
const another = document.getElementById('another');
const sample = document.getElementById('sample');

function showError(text) {
  errorEl.textContent = text;
  errorEl.hidden = !text;
}

function showDrop() {
  player.pause();
  stage.hidden = true;
  drop.hidden = false;
  input.value = '';
  drop.focus();
}

function play(bytes, label) {
  showError('');
  nameEl.textContent = label;
  drop.hidden = true;
  stage.hidden = false;
  player.source = bytes;
}

async function openFile(file) {
  if (!file) return;
  if (!/\.lottie$/i.test(file.name)) {
    showError(`${file.name} is not a .lottie file. Drop the film.lottie that talkie build makes.`);
    return;
  }
  if (file.size > MAX_BYTES) {
    showError(`${file.name} is too big to open here.`);
    return;
  }
  try {
    play(new Uint8Array(await file.arrayBuffer()), file.name);
  } catch {
    showError(`${file.name} could not be read.`);
  }
}

player.addEventListener('error', (event) => {
  const code = event.detail?.code ?? player.error?.code;
  showError(MESSAGES[code] ?? 'The film could not be played.');
});

drop.addEventListener('click', (event) => {
  if (event.target !== sample) input.click();
});
drop.addEventListener('keydown', (event) => {
  if (event.target !== drop) return;
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    input.click();
  }
});
input.addEventListener('change', () => openFile(input.files?.[0]));
another.addEventListener('click', showDrop);

sample.addEventListener('click', async () => {
  try {
    const res = await fetch('./sample.lottie');
    if (!res.ok) throw new Error(String(res.status));
    play(new Uint8Array(await res.arrayBuffer()), 'Sample film');
  } catch {
    showError('The sample film could not be loaded.');
  }
});

// Drag and drop anywhere on the page.
let depth = 0;
window.addEventListener('dragenter', (event) => {
  event.preventDefault();
  depth += 1;
  document.body.classList.add('dragging');
});
window.addEventListener('dragleave', () => {
  depth = Math.max(0, depth - 1);
  if (depth === 0) document.body.classList.remove('dragging');
});
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => {
  event.preventDefault();
  depth = 0;
  document.body.classList.remove('dragging');
  openFile(event.dataTransfer?.files?.[0]);
});
