const chat = document.getElementById("chat");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const fileInput = document.getElementById("fileInput");

sendBtn.addEventListener("click", sendMessage);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage();
});

function appendMessage(text, sender) {
  const msg = document.createElement("div");
  msg.className = "message " + sender;
  msg.innerText = text;
  chat.appendChild(msg);
  chat.scrollTop = chat.scrollHeight;
}

async function sendMessage() {
  const message = input.value.trim();
  if (!message && !fileInput.files.length) return;

  appendMessage(message, "user");
  input.value = "";

  const formData = new FormData();
  formData.append("message", message);
  if (fileInput.files[0]) {
    formData.append("file", fileInput.files[0]);
  }

  appendMessage("Sto elaborando...", "assistant");

  try {
    const res = await fetch("/.netlify/functions/chat", {
      method: "POST",
      body: formData,
    });

    // Se la risposta è un PDF/file
    const contentType = res.headers.get("Content-Type");
    if (contentType && contentType.includes("application/pdf")) {
      // Crea link per scaricare il file
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      appendMessage("Risultato pronto: ", "assistant");
      const link = document.createElement("a");
      link.href = url;
      link.download = "risultato.pdf";
      link.innerText = "Scarica PDF";
      link.style.display = "block";
      chat.appendChild(link);
      chat.scrollTop = chat.scrollHeight;
    } else {
      // Altrimenti è risposta testuale JSON
      const data = await res.json();
      appendMessage(data.reply, "assistant");
    }
  } catch (err) {
    appendMessage("Errore di rete o di server.", "assistant");
  }

  fileInput.value = ""; // reset file input
}
