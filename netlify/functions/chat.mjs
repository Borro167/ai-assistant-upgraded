import { OpenAI } from "openai";
import multipart from "parse-multipart";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const handler = async (event) => {
  try {
    console.log("event.headers:", event.headers);

    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: "Method not allowed" }),
      };
    }

    const contentType =
      event.headers["content-type"] ||
      event.headers["Content-Type"] ||
      "";
    console.log("Detected content-type:", contentType);

    let message = "";
    let fileIds = [];

    // --- CASO 1: UPLOAD FILE ---
    if (contentType && contentType.includes("multipart/form-data")) {
      // Estrai boundary SOLO con la regex!
      const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
      if (!boundaryMatch) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: "Boundary mancante",
            contentType,
          }),
        };
      }
      const cleanBoundary = boundaryMatch[1];

      const bodyBuffer = Buffer.from(event.body, "base64");
      const parts = multipart.Parse(bodyBuffer, cleanBoundary);

      console.log("parts:", parts);

      // Cerca file e campo message
      let filePart = parts.find((p) => p.filename);
      let messagePart = parts.find((p) => p.name === "message");

      if (filePart && filePart.data) {
        // Carica su OpenAI solo se esiste data!
        const uploaded = await openai.files.create({
          file: Buffer.from(filePart.data),
          filename: filePart.filename,
          purpose: "assistants",
        });
        fileIds.push(uploaded.id);
      }

      // Gestione message
      message =
        messagePart && messagePart.data
          ? messagePart.data.toString()
          : "";

      if (!message && !filePart) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: "Richiesta vuota: manca messaggio e file.",
          }),
        };
      }

    // --- CASO 2: SOLO MESSAGGIO (JSON) ---
    } else if (contentType && contentType.includes("application/json")) {
      const body = JSON.parse(event.body);
      message = body.message || "";
      if (!message) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: "Nessun messaggio nel body.",
          }),
        };
      }
    } else {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "Content-Type non supportato",
          contentType,
        }),
      };
    }

    // --- INTERAZIONE ASSISTANT ---
    const assistantId = process.env.OPENAI_ASSISTANT_ID;
    const thread = await openai.beta.threads.create();

    // Invia messaggio e file (se presente)
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: message,
      ...(fileIds.length > 0 ? { file_ids: fileIds } : {}),
    });

    // Avvia il run
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: assistantId,
    });

    // Attendi il completamento
    let result;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 500));
      result = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      if (result.status === "completed") break;
    }

    // Recupera i messaggi finali
    const messages = await openai.beta.threads.messages.list(thread.id);
    const last = messages.data.find((msg) => msg.role === "assistant");

    if (!last) {
      return {
        statusCode: 502,
        body: JSON.stringify({
          error: "Nessuna risposta dall'assistente",
        }),
      };
    }

    // --- GESTIONE RISPOSTA FILE (PDF, ecc.) ---
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

    // --- GESTIONE RISPOSTA TESTUALE ---
    const textReply = last.content
      .filter((c) => c.type === "text")
      .map((c) => c.text.value)
      .join("\n");

    return {
      statusCode: 200,
      body: JSON.stringify({ reply: textReply }),
    };

  } catch (err) {
    // LOG DELL'ERRORE COMPLETO
    console.error("FATAL ERROR:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || "Errore interno." }),
    };
  }
};
