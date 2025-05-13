import { parseMultipartFormData } from '@netlify/functions';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Method not allowed',
    };
  }

  try {
    const form = await parseMultipartFormData(event);
    const fields = Object.fromEntries(form.fields);
    const files = Object.fromEntries(form.files);

    const userMessage = fields.message || '';
    const threadId = fields.threadId || null;
    const file = files.file;

    const thread = threadId
      ? { id: threadId }
      : await openai.beta.threads.create();

    const messages = [
      {
        role: 'user',
        content: userMessage,
      },
    ];

    if (file && file.tmpPath) {
      const upload = await openai.files.create({
        file: file.tmpPath,
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
