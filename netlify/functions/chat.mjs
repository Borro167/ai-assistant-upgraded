import { IncomingForm } from 'formidable';
import fs from 'fs';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const parseForm = (event) =>
  new Promise((resolve, reject) => {
    const form = new IncomingForm({ uploadDir: '/tmp', keepExtensions: true });

    form.parse(event, (err, fields, files) => {
      if (err) return reject(err);
      resolve({ fields, files });
    });
  });

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Method not allowed',
    };
  }

  try {
    const buffer = Buffer.from(event.body, 'base64');
    const fakeReq = {
      headers: event.headers,
      method: event.httpMethod,
      url: '/',
      on: (eventName, cb) => {
        if (eventName === 'data') cb(buffer);
        if (eventName === 'end') cb();
      },
    };

    const { fields, files } = await parseForm(fakeReq);

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
