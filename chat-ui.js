let selectedFile = null;

const chat = document.getElementById("chat");
const input = document.getElementById("message");
const sendBtn = document.getElementById("sendBtn");
const dropZone = document.getElementById("drop-zone");
const fileStatus = document.getElementById("file-status");

sendBtn.addEventListener("click", sendMessage);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    sendMessage();
  }
});

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  if (e.dataTransfer.files.length > 0) {
    selectedFile = e.dataTransfer.files[0];
    fileStatus.textContent = `File caricato: ${selectedFile.name}`;
  }
});

async function sendMessage() {
  const text = input.value.trim();
  if (!text && !selectedFile) return;

  appendMessage("user", text || `[File: ${selectedFile.name}]`);

  const formData = new FormData();
  formData.append("message", text || "Analizza il file allegato");
  if (selectedFile) formData.append("file", selectedFile);

  try {
    const res = await fetch("/.netlify/functions/chat", {
      method: "POST",
      body: formData,
    });
    const data = await res.json();
    const reply = data.message || "[Nessuna risposta]";
    appendMessage("bot", reply);
  } catch (err) {
    console.error(err);
    appendMessage("bot", "[Errore di rete]");
  }

  input.value = "";
  selectedFile = null;
  fileStatus.textContent = "Nessun file caricato";
}

function appendMessage(role, text) {
  const div = document.createElement("div");
  div.className = `message ${role === "user" ? "user" : "bot"}`;
  div.textContent = text;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}
