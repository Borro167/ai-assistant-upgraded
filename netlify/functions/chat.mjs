import { IncomingForm } from 'formidable';
import fs from 'fs';
import { Readable } from 'stream';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function buildReadableRequest(event) {
  const buffer = Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8');
  const readable = Readable.from([buffer]);
  readable.headers = event.headers;
  readable.method = event.httpMethod;
  readable.url = '/';
  return readable;
}

function parseFormData(req) {
  return new Promise((resolve, reject) => {
    const form = new IncomingForm({ uploadDir: '/tmp', keepExtensions: true });
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      resolve({ fields, files });
    });
  });
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const req = buildReadableRequest(event);
    const { fields, files } = await parseFormData(req);

    const userMessage = Array.isArray(fields.message)
      ? fields.message[0]
      : fields.message || '';

    const threadId = fields.threadId || null;
    const file = Array.isArray(files.file) ? files.file[0] : files.file;

    const thread = threadId ? { id: threadId } : await openai.beta.threads.create();

    let fileId = null;
    if (file && file.filepath) {
      const upload = await openai.files.create({
        file: fs.createReadStream(file.filepath),
        purpose: 'assistants'
      });
      fileId = upload.id;

      // Opzionale: indicizza file in un vector store se il tuo assistant lo usa
      if (
        openai.beta?.vectorStores?.fileBatches?.uploadAndPoll &&
        process.env.OPENAI_VECTOR_STORE_ID
      ) {
        await openai.beta.vectorStores.fileBatches.uploadAndPoll(
          process.env.OPENAI_VECTOR_STORE_ID,
          { files: [fileId] }
        );
      }
    }

    // --- Costruisci il payload con attachments e tools ---
    const messagePayload = {
      role: 'user',
      content: [{ type: 'text', text: userMessage }],
      ...(fileId && {
        attachments: [
          {
            file_id: fileId,
            // Specifica TUTTI i tool che vuoi che possano accedere al file
            tools: [
              { type: "code_interpreter" },
              { type: "file_search" }
            ]
          }
        ]
      })
    };

    await openai.beta.threads.messages.create(thread.id, messagePayload);

    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: process.env.OPENAI_ASSISTANT_ID,
    });

    let runStatus;
    do {
      runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      await new Promise((res) => setTimeout(res, 1000));
    } while (runStatus.status !== 'completed' && runStatus.status !== 'failed' && runStatus.status !== 'cancelled');

    if (runStatus.status !== 'completed') {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: `Assistant run failed: ${runStatus.status}` })
      };
    }

    const messagesResponse = await openai.beta.threads.messages.list(thread.id);
    // Trova l'ultima risposta dell'assistente
    const lastAssistantMsg = messagesResponse.data.find(m => m.role === "assistant") || messagesResponse.data[0] || { content: [] };

    const textReply = lastAssistantMsg.content
      ?.filter(c => c.type === 'text')
      ?.map(c => c.text?.value)
      ?.join('\n')
      ?.trim() || '[Nessuna risposta generata]';

    return {
      statusCode: 200,
      body: JSON.stringify({
        threadId: thread.id,
        message: textReply
      })
    };
  } catch (err) {
    console.error('❌ Error in handler:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
