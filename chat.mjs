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
      event.headers["content-type"] || event.headers["Content-Type"] || "";
    console.log("Detected content-type:", contentType);

    let message = "";
    let fileIds = [];

    // --- CASO 1: multipart/form-data ---
    if (contentType.includes("multipart/form-data")) {
      const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
      if (!boundaryMatch) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: "Boundary mancante", contentType }),
        };
      }
      const cleanBoundary = boundaryMatch[1];
      console.log("Boundary trovato:", cleanBoundary);

      if (!event.isBase64Encoded) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: "Body non in base64" }),
        };
      }

      const bodyBuffer = Buffer.from(event.body, "base64");
      console.log("Body buffer length:", bodyBuffer.length);

      let parts = [];
      let filePart = null;
      let messagePart = null;

      try {
        if (bodyBuffer.length < 300) {
          // Caso: solo testo "message"
          const raw = bodyBuffer.toString("utf8");
          const match = raw.match(/name="message"\s+([\s\S]*)--/);
          message = match ? match[1].trim() : "";
          console.log("Estratto messaggio da solo testo:", message);
        } else {
          const raw = bodyBuffer.toString("utf8");
          const isValidBoundary = raw.includes(cleanBoundary);
          if (!isValidBoundary) {
            throw new Error("Boundary non trovato nel body");
          }

          parts = multipart.Parse(bodyBuffer, cleanBoundary).filter(
            (p) => p && typeof p.data !== "undefined" && p.data !== null
          );

          console.log("Parts dopo filtro:", parts);

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
        }
      } catch (err) {
        console.error("Errore robusto parse-multipart:", err.message);
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
    else if (contentType.includes("application/json")) {
      const body = JSON.parse(event.body);
      message = body.message || "";
      if (!message) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: "Messaggio mancante" }),
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

    // --- POLLING STATO RUN ---
    let result;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 500));
      result = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      if (result.status === "completed") break;
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
    console.error("FATAL ERROR:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: err.message || "Errore interno",
      }),
    };
  }
};
