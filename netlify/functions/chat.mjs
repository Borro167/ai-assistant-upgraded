import OpenAI from "openai";
import { parse } from "formdata-node/parser";
import { FormData } from "formdata-node";
import { Readable } from "stream";
import fetch from "node-fetch";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const formData = await parse(event);
  const message = formData.get("message");
  const file = formData.get("file");

  const thread = await openai.beta.threads.create();
  const threadId = thread.id;

  let fileId;
  if (file) {
    const upload = await openai.files.create({
      file: file.stream,
      purpose: "assistants",
    });
    fileId = upload.id;
  }

  await openai.beta.threads.messages.create(threadId, {
    role: "user",
    content: message,
    ...(fileId ? { file_ids: [fileId] } : {}),
  });

  const run = await openai.beta.threads.runs.create(threadId, {
    assistant_id: process.env.OPENAI_ASSISTANT_ID,
  });

  let result;
  while (true) {
    result = await openai.beta.threads.runs.retrieve(threadId, run.id);
    if (result.status === "completed") break;
    if (["failed", "cancelled"].includes(result.status)) throw new Error("Run error");
    await new Promise(r => setTimeout(r, 1000));
  }

  const messages = await openai.beta.threads.messages.list(threadId);
  const last = messages.data.find(m => m.role === "assistant");

  return {
    statusCode: 200,
    body: JSON.stringify({ message: last?.content[0]?.text?.value || "[Nessuna risposta]" }),
  };
};
