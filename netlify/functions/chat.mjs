import { IncomingForm } from 'formidable';
import fs from 'fs';
import stream from 'stream';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function eventToReq(event) {
  const readable = new stream.Readable();
  readable._read = () => {}; // required
  readable.push(Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8'));
  readable.push(null);

  return {
    headers: event.headers,
    method: event.httpMethod,
    url: '/',
    ...readable,
  };
}

function parseMultipartForm(req) {
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
    return {
      statusCode: 405,
      body: 'Method not allowed',
    };
  }

  try {
    const req = eventToReq(event);
    const { fields, files } = await parseMultipartForm(req);

    const userMessage = fields.message || '';
    const threadId = fields.threadId || null;
    const file = files.file;

    const thread = threadId
      ? { id: threadId }
      : await openai.beta.threads.create();

    const messages = [{ role: 'user', content: userMessage }];

    if (file && file.filepath) {
      const upload = await openai.files.create({
        file: fs.createReadStream(file.filepath),
        purpose: 'assistants',
      });
      messages[0].file_ids = [upload.id];
    }

    await openai.beta.threads.messages.create(thread.id, messages[0]);

    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: process.env.OPENAI_ASSISTANT_ID,
    });

    let runStatus;
    do {
      runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      await new Promise((res) => setTimeout(res, 1000));
    } while (runStatus.status !== 'completed');

    const messagesResponse = await openai.beta.threads.messages.list(thread.id);
    const lastMessage = messagesResponse.data[0];

    return {
      statusCode: 200,
      body: JSON.stringify({
        threadId: thread.id,
        message: lastMessage.content,
      }),
    };
  } catch (err) {
    console.error('Error in handler:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
