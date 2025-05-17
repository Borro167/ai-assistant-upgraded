import { OpenAI } from "openai";
import multipart from "parse-multipart";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  const contentType = event.headers['content-type'] || event.headers['Content-Type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Content-Type non multipart/form-data" }),
    };
  }
  const boundary = contentType.split("boundary=")[1];
  if (!boundary) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Boundary mancante" }),
    };
  }

  const bodyBuffer = Buffer.from(event.body, "base64");
  const parts = multipart.Parse(bodyBuffer, boundary);

  // Trova il file e il messaggio
  let filePart = parts.find((p) => p.filename);
  let messagePart = parts.find((p) => p.name === "message");
  let fileIds = [];

  // Carica file su OpenAI se presente
  if (filePart) {
    const uploaded = await openai.files.create({
      file: Buffer.from(filePart.data),
      filename: filePart.filename,
      purpose: "assistants",
    });
    fileIds.push(uploaded.id);
  }

  const message = messagePart ? messagePart.data.toString() : "";
  const assistantId = process.env.OPENAI_ASSISTANT_ID;

  // Assistant run
  const thread = await openai.beta.threads.create();
  await openai.beta.threads.messages.create(thread.id, {
    role: "user",
    content: message,
    ...(fileIds.length > 0 ? { file_ids: fileIds } : {}),
  });

  const run = await openai.beta.threads.runs.create(thread.id, {
    assistant_id: assistantId,
  });

  // Polling
  let result;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    result = await openai.beta.threads.runs.retrieve(thread.id, run.id);
    if (result.status === "completed") break;
  }

  const messages = await openai.beta.threads.messages.list(thread.id);
  const last = messages.data.find((msg) => msg.role === "assistant");
  if (!last) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: "Nessuna risposta dall'assistente" }),
    };
  }

  // File o testo?
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

  // Altrimenti risposta testuale
  const textReply = last.content
    .filter((c) => c.type === "text")
    .map((c) => c.text.value)
    .join("\n");
  return {
    statusCode: 200,
    body: JSON.stringify({ reply: textReply }),
  };
};
