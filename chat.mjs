import { OpenAI } from "openai";
import multipart from "parse-multipart";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const handler = async (event) => {
  try {
    // Controllo variabili ambiente
    if (!process.env.OPENAI_API_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "API Key OpenAI mancante" }),
      };
    }
    if (!process.env.OPENAI_ASSISTANT_ID) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Assistant ID mancante" }),
      };
    }

    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: "Method not allowed" }),
      };
    }

    // Detect Content-Type in modo robusto e case-insensitive
    const contentType = Object.entries(event.headers || {})
      .find(([k]) => k.toLowerCase() === "content-type")?.[1] || "";

    let message = "";
    let fileIds = [];

    // --- CASO 1: multipart/form-data ---
    if (contentType.toLowerCase().includes("multipart/form-data")) {
      const boundaryMatch = contentType.match(/boundary=([^\s;]+)/i);
      if (!boundaryMatch) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: "Boundary mancante", contentType }),
        };
      }
      const cleanBoundary = boundaryMatch[1];

      if (!event.isBase64Encoded) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: "Body non in base64" }),
        };
      }

      const bodyBuffer = Buffer.from(event.body, "base64");

      let parts = [];
      let filePart = null;
      let messagePart = null;

      try {
        parts = multipart.Parse(bodyBuffer, cleanBoundary).filter(
          (p) => p && typeof p.data !== "undefined" && p.data !== null
        );

        filePart = parts.find((p) => p.filename && p.data);
        messagePart = parts.find((p) => p.name === "message" && p.data);

        if (filePart) {
          const uploaded = await openai.files.create({
            file: Buffer.from(filePart.data),
            filename: filePart.filename,
            purpose: "assistants",
          });
          fileIds.push(uploaded.id);
        }

        message = messagePart
          ? messagePart.data.toString("utf8").trim()
          : "";
      } catch (err) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: "Errore parsing multipart: " + err.message,
          }),
        };
      }

      if (!message && fileIds.length === 0) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: "Richiesta vuota: manca messaggio e file",
          }),
        };
      }
    }

    // --- CASO 2: application/json ---
    else if (contentType.toLowerCase().includes("application/json")) {
      const body = JSON.parse(event.body);
      message = body.message || "";
      if (!message) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: "Messaggio mancante" }),
        };
      }
    } else {
      // Content-Type non supportato
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "Content-Type non supportato",
          contentType,
        }),
      };
    }

    // --- CREA THREAD ASSISTANT ---
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

    // --- POLLING STATO RUN (massimo 9 secondi: 18x0.5s) ---
    let result;
    for (let i = 0; i < 18; i++) {
      await new Promise((r) => setTimeout(r, 500));
      result = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      if (result.status === "completed") break;
    }
    if (result.status !== "completed") {
      return {
        statusCode: 504,
        body: JSON.stringify({ error: "Timeout assistente: la risposta richiede troppo tempo. Riprova più tardi." }),
      };
    }

    // --- RECUPERA RISPOSTA ---
    const messages = await openai.beta.threads.messages.list(thread.id);
    const last = messages.data.find((m) => m.role === "assistant");

    if (!last) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: "Nessuna risposta dall'assistente" }),
      };
    }

    const fileResponse = last.content.find((c) => c.type === "file");
    if (fileResponse) {
      const fileId = fileResponse.file_id;
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

    const textReply = last.content
      .filter((c) => c.type === "text")
      .map((c) => c.text.value)
      .join("\n");

    return {
      statusCode: 200,
      body: JSON.stringify({ reply: textReply }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: err.message || "Errore interno",
      }),
    };
  }
};
