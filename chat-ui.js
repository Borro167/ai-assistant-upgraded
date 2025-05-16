// Selezione elementi base
const chatBox = document.getElementById('chat');
const input = document.getElementById('message');
const sendBtn = document.getElementById('send');
const fileInput = document.getElementById('file');
const form = document.getElementById('chat-form');
let threadId = null; // Per mantenere la conversazione

// Utility per aggiungere messaggi al DOM
function addMessage(text, sender = 'user') {
  const msg = document.createElement('div');
  msg.className = `message ${sender}`;
  msg.innerText = text;
  chatBox.appendChild(msg);
  chatBox.scrollTop = chatBox.scrollHeight;
}

// Spinner di attesa
function showSpinner() {
  const spinner = document.createElement('div');
  spinner.className = 'message assistant spinner';
  spinner.id = 'spinner';
  spinner.innerText = '...';
  chatBox.appendChild(spinner);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function hideSpinner() {
  const spinner = document.getElementById('spinner');
  if (spinner) spinner.remove();
}

// Invio messaggio a Netlify function
async function sendMessage(e) {
  if (e) e.preventDefault();

  const text = input.value.trim();
  const file = fileInput.files[0];

  if (!text && !file) return;

  addMessage(text || (file && `📎 ${file.name}`), 'user');
  input.value = '';
  fileInput.value = '';

  showSpinner();

  const formData = new FormData();
  if (text) formData.append('message', text);
  if (file) formData.append('file', file);
  if (threadId) formData.append('threadId', threadId);

  try {
    const res = await fetch('/.netlify/functions/chat', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    hideSpinner();

    if (data.error) {
      addMessage('❌ Errore: ' + (data.error || 'Errore generico.'), 'assistant');
      if (data.details) {
        addMessage('Dettaglio: ' + JSON.stringify(data.details), 'assistant');
      }
      return;
    }

    threadId = data.threadId || threadId;
    addMessage(data.message, 'assistant');
  } catch (err) {
    hideSpinner();
    addMessage('❌ Errore di rete o server.', 'assistant');
  }
}

// Event listeners
form.addEventListener('submit', sendMessage);
sendBtn.addEventListener('click', sendMessage);
input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    sendMessage(e);
  }
});

// Drag & drop file
chatBox.addEventListener('dragover', e => {
  e.preventDefault();
  chatBox.classList.add('dragover');
});
chatBox.addEventListener('dragleave', () => {
  chatBox.classList.remove('dragover');
});
chatBox.addEventListener('drop', e => {
  e.preventDefault();
  chatBox.classList.remove('dragover');
  if (e.dataTransfer.files.length) {
    fileInput.files = e.dataTransfer.files;
    addMessage(`📎 ${e.dataTransfer.files[0].name}`, 'user');
  }
});
