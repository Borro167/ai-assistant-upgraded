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

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragover");
});

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
  formData.append("message", text || "Analizza il file caricato");
  if (selectedFile) {
    formData.append("file", selectedFile);
  }

  try {
    const res = await fetch("/.netlify/functions/chat", {
      method: "POST",
      body: formData,
    });

    const data = await res.json();
    let reply = "[Nessuna risposta]";

    if (typeof data.message === "string") {
      reply = data.message;
    }

    appendMessage("bot", reply);
  } catch (err) {
    console.error("❌ Errore:", err);
    appendMessage("bot", "[Errore di rete o risposta]");
  }

  input.value = "";
  selectedFile = null;
  fileStatus.textContent = "Nessun file caricato";
}

function appendMessage(role, text) {
  const msg = document.createElement("div");
  msg.className = `message ${role}`;
  msg.textContent = text;
  chat.appendChild(msg);
  chat.scrollTop = chat.scrollHeight
