import { ReadableStream } from 'node:stream/web';
import { parse } from 'formdata-node/parser';
import { FormData } from 'formdata-node';
import OpenAI from 'openai';
import fetch from 'node-fetch';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const formData = await readFormData(event);
  const message = formData.get("message") || "";
  const file = formData.get("file");

  try {
    const thread = await openai.beta.threads.create();
    const threadId = thread.id;

    let fileId;
    if (file) {
      const upload = await openai.files.create({
        file: file.stream,
        purpose: "assistants",
      });
      fileId = upload.id;

      await openai.beta.threads.messages.create(threadId, {
        role: "user",
        content: message,
        file_ids: [fileId],
      });
    } else {
      await openai.beta.threads.messages.create(threadId, {
        role: "user",
        content: message,
      });
    }

    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: process.env.OPENAI_ASSISTANT_ID,
    });

    let result;
    while (true) {
      result = await openai.beta.threads.runs.retrieve(threadId, run.id);
      if (result.status === "completed" || result.status === "requires_action") break;
      await new Promise((r) => setTimeout(r, 1000));
    }

    if (result.status === "requires_action") {
      const tool = result.required_action.submit_tool_outputs.tool_calls[0];
      const { name, arguments: args } = tool.function;
      const parsedArgs = JSON.parse(args);

      let toolResponse = "";
      if (name === "analizza_file_regressione") {
        const res = await fetch(`${process.env.RENDER_BACKEND_URL}/analizza`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file_url: parsedArgs.file_url }),
        });
        toolResponse = await res.text();
      }

      if (name === "stima") {
        const res = await fetch(`${process.env.RENDER_BACKEND_URL}/stima`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsedArgs),
        });
        toolResponse = await res.text();
      }

      await openai.beta.threads.runs.submitToolOutputs(threadId, run.id, {
        tool_outputs: [
          {
            tool_call_id: tool.id,
            output: toolResponse,
          },
        ],
      });

      while (true) {
        result = await openai.beta.threads.runs.retrieve(threadId, run.id);
        if (result.status === "completed") break;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    const messages = await openai.beta.threads.messages.list(threadId);
    const last = messages.data.find((m) => m.role === "assistant");

    return {
      statusCode: 200,
      body: JSON.stringify({ reply: last.content[0].text.value }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: `Errore: ${err.message}`,
    };
  }
};

async function readFormData(event) {
  const boundary = event.headers["content-type"].split("boundary=")[1];
  const buf = Buffer.from(event.body, "base64");
  const stream = ReadableStream.from(buf);
  return await parse(stream, boundary);
}
