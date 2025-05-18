import { OpenAI } from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: "Method not allowed" }),
      };
    }

    const contentType =
      event.headers["content-type"] || event.headers["Content-Type"] || "";
    if (!contentType.includes("application/json")) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Content-Type non supportato" }),
      };
    }

    const { message, fileId } = JSON.parse(event.body);
    if (!message && !fileId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Messaggio o fileId mancante" }),
      };
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
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 500));
      result = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      if (result.status === "completed") break;
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
          "Content-Disposition": "attachment; filename=risultato.pdf"
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
    console.error("Errore:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || "Errore interno" }),
    };
  }
};
