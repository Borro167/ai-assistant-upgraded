import { OpenAI } from "openai";
import formidable from "formidable";
import fs from "fs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Parse incoming form-data (file + message)
  const form = formidable({ multiples: false });
  form.parse(req, async (err, fields, files) => {
    if (err) {
      return res.status(400).json({ error: "Errore parsing form" });
    }

    const userMessage = fields.message || "";
    const assistantId = process.env.OPENAI_ASSISTANT_ID;

    let fileIds = [];
    // Se è stato caricato un file, lo carico su OpenAI
    if (files.file) {
      const fileStream = fs.createReadStream(files.file.filepath);
      const uploaded = await openai.files.create({
        file: fileStream,
        purpose: "assistants",
      });
      fileIds.push(uploaded.id);
    }

    // Crea thread assistant
    const thread = await openai.beta.threads.create();

    // Crea messaggio utente, allegando eventuale file
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: userMessage,
      ...(fileIds.length > 0 ? { file_ids: fileIds } : {}),
    });

    // Fa partire l'assistente
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: assistantId,
    });

    // Polling per attesa completamento (max 30 sec)
    let result;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 500));
      result = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      if (result.status === "completed") break;
    }

    // Recupera risposta
    const messages = await openai.beta.threads.messages.list(thread.id);
    const last = messages.data.find((msg) => msg.role === "assistant");
    if (!last) {
      return res.status(502).json({ error: "Nessuna risposta dall'assistente" });
    }

    // Cerca eventuale file in risposta
    const attachments = last.content.filter(
      (c) => c.type === "file"
    );
    if (attachments.length > 0) {
      // Scarica e inoltra il file generato dall'assistente (es. PDF)
      const fileId = attachments[0].file_id;
      const file = await openai.files.retrieveContent(fileId);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", "attachment; filename=risultato.pdf");
      return file.pipe(res);
    }

    // Altrimenti restituisci risposta testuale
    const textReply = last.content
      .filter((c) => c.type === "text")
      .map((c) => c.text.value)
      .join("\n");
    res.status(200).json({ reply: textReply });
  });
}
