import { OpenAI } from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const handler = async (event) => {
  try {
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

    const headers = event.headers || {};
    const contentType =
      headers["content-type"] ||
      headers["Content-Type"] ||
      headers["CONTENT-TYPE"] ||
      "";

    if (!contentType.toLowerCase().includes("application/json")) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Content-Type non supportato", contentType }),
      };
    }

    const body = JSON.parse(event.body);
    const message = body.message || "";
    const fileDataUrl = body.file || null;

    if (!message && !fileDataUrl) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Messaggio e file mancanti" }),
      };
    }

    let fileId = null;
    if (fileDataUrl) {
      const matches = fileDataUrl.match(/^data:(.+);base64,(.+)$/);
      if (!matches) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: "Formato file non valido" }),
        };
      }
      const mimeType = matches[1];
      const base64Data = matches[2];
      const buffer = Buffer.from(base64Data, "base64");

      const uploaded = await openai.files.create({
        file: buffer,
        filename: "upload.pdf",
        purpose: "assistants",
      });
      fileId = uploaded.id;
    }

    const assistantId = process.env.OPENAI_ASSISTANT_ID;
    const thread = await openai.beta.threads.create();

    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: message,
      ...(fileId ? { file_ids: [fileId] } : {}),
    });

    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: assistantId,
    });

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
