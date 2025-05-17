import { OpenAI } from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Per Netlify, formData() viene dalla richiesta "Request" (non stream Node puro)
  const formData = await req.formData();
  const message = formData.get("message") || "";
  const assistantId = process.env.OPENAI_ASSISTANT_ID;

  let fileIds = [];
  const file = formData.get("file");

  if (file && file.name) {
    // file è di tipo Blob/File (Web API), va convertito in Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const uploaded = await openai.files.create({
      file: buffer,
      filename: file.name,
      purpose: "assistants",
    });
    fileIds.push(uploaded.id);
  }

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
    return res.status(502).json({ error: "Nessuna risposta dall'assistente" });
  }

  // File o testo?
  const attachments = last.content.filter((c) => c.type === "file");
  if (attachments.length > 0) {
    const fileId = attachments[0].file_id;
    const file = await openai.files.retrieveContent(fileId);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=risultato.pdf");
    return file.pipe(res);
  }

  const textReply = last.content
    .filter((c) => c.type === "text")
    .map((c) => c.text.value)
    .join("\n");
  res.status(200).json({ reply: textReply });
};
