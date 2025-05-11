let fileToUpload = null;

async function sendMessage() {
  const input = document.getElementById("message");
  const text = input.value.trim();
  if (!text && !fileToUpload) return;

  appendMessage(text || "File inviato per analisi", "user");

  const formData = new FormData();
  formData.append("message", text || "Analizza questo file");
  if (fileToUpload) {
    formData.append("file", fileToUpload);
  }

  const res = await fetch("/.netlify/functions/chat", {
    method: "POST",
    body: formData,
  });

  const json = await res.json();
  appendMessage(json.reply || "[Nessuna risposta]", "bot");

  document.getElementById("message").value = "";
  fileToUpload = null;
  document.getElementById("file-status").textContent = "Nessun file caricato";
}

function appendMessage(text, sender) {
  const chat = document.getElementById("chat");
  const msg = document.createElement("div");
  msg.className = `message ${sender}`;
  msg.textContent = text;
  chat.appendChild(msg);
  chat.scrollTop = chat.scrollHeight;
}

const dropZone = document.getElementById("drop-zone");
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

  const file = e.dataTransfer.files[0];
  if (!file) return;

  if (!["application/pdf", "text/csv"].includes(file.type) && !file.name.endsWith(".csv")) {
    alert("Solo file PDF o CSV sono supportati.");
    return;
  }

  fileToUpload = file;
  document.getElementById("file-status").textContent = `File pronto: ${file.name}`;
});