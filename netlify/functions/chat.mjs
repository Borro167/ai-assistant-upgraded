import { OpenAI } from "openai";
import multipart from "parse-multipart";

/**
 * Function Netlify compatibile per chat AI con upload file (PDF/CSV) e prompt testuale.
 * - Gestione robusta content-type/boundary: regex, mai .split() su undefined
 * - Funziona sia con multipart/form-data (upload file) sia con application/json (solo testo)
 * - Se la risposta dell’assistente è un PDF, lo invia come file base64
 * - Restituisce errori chiari se la richiesta non è conforme
 */

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const handler = async (event) => {
  console.log("event.headers:", event.headers);

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  // 1. Content-Type: gestito sempre in modo robusto
  const contentType = event.headers['content-type'] || event.headers['Content-Type'] || '';
  console.log("Detected content-type:", contentType);

  let message = "";
  let fileIds = [];

  // 2. FILE UPLOAD (multipart/form-data)
  if (contentType && contentType.includes('multipart/form-data')) {
    /**
     * Estrazione boundary:
     * - Usa regex /boundary=([^\s;]+)/
     * - Prende solo il valore dopo 'boundary=', senza rischiare undefined
     * - NON usa split/trim su valori incerti!
     */
    const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
    if (!boundaryMatch) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Boundary mancante", contentType }),
      };
    }
    const cleanBoundary = boundaryMatch[1];

    const bodyBuffer = Buffer.from(event.body, "base64");
    const parts = multipart.Parse(bodyBuffer, cleanBoundary);

    // Trova file e messaggio nel form
    let filePart = parts.find((p) => p.filename);
    let messagePart = parts.find((p) => p.name === "message");

    if (filePart) {
      const uploaded = await openai.files.create({
        file: Buffer.from(filePart.data),
        filename: filePart.filename,
        purpose: "assistants",
      });
      fileIds.push(uploaded.id);
    }

    message = messagePart ? messagePart.data.toString() : "";

  // 3. SOLO TESTO (application/json)
  } else if (contentType && contentType.includes('application/json')) {
    const body = JSON.parse(event.body);
    message = body.message || "";
  } else {
    // Content-Type non gestito o mancante
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Content-Type non supportato", contentType }),
    };
  }

  // 4. Assistant OpenAI: crea thread e invia messaggio (e file)
  const assistantId = process.env.OPENAI_ASSISTANT_ID;
  const thread = await openai.beta.threads.create();
  await openai.beta.threads.messages.create(thread.id, {
    role: "user",
    content: message,
    ...(fileIds.length > 0 ? { file_ids: fileIds } : {}),
  });

  const run = await openai.beta.threads.runs.create(thread.id, {
    assistant_id: assistantId,
  });

  // 5. Polling (aspetta che la risposta sia pronta, max 30s)
  let result;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    result = await openai.beta.threads.runs.retrieve(thread.id, run.id);
    if (result.status === "completed") break;
  }

  // 6. Recupera risposta assistant: PDF/file o solo testo
  const messages = await openai.beta.threads.messages.list(thread.id);
  const last = messages.data.find((msg) => msg.role === "assistant");
  if (!last) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: "Nessuna risposta dall'assistente" }),
    };
  }

  // Se la risposta contiene un file (es. PDF generato)
  const attachments = last.content.filter((c) => c.type === "file");
  if (attachments.length > 0) {
    const fileId = attachments[0].file_id;
    const file = await openai.files.retrieveContent(fileId);
    const chunks = [];
    for await (const chunk of file) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=risultato.pdf",
      },
      body: buffer.toString("base64"),
      isBase64Encoded: true,
    };
  }

  // Altrimenti restituisce risposta testuale
  const textReply = last.content
    .filter((c) => c.type === "text")
    .map((c) => c.text.value)
    .join("\n");
  return {
    statusCode: 200,
    body: JSON.stringify({ reply: textReply }),
  };
};
