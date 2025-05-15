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
    return {
      statusCode: 405,
      body: 'Method not allowed',
    };
  }

  try {
    const req = buildReadableRequest(event);
    const { fields, files } = await parseFormData(req);

    const userMessage = Array.isArray(fields.message) ? fields.message[0] : fields.message || '';
    const file = Array.isArray(files.file) ? files.file[0] : files.file;

    // ✅ Carica il file nel vector store se presente
    if (file && file.filepath) {
      const upload = await openai.files.create({
        file: fs.createReadStream(file.filepath),
        purpose: "assistants"
      });

      console.log("📂 File caricato:", upload.id);
      console.log("🔄 Attendi che venga indicizzato nel vector store...");

      // Carica nel vector store esistente (ID fisso configurato in assistant stesso)
      await openai.beta.vectorStores.fileBatches.uploadAndPoll(
        process.env.OPENAI_VECTOR_STORE_ID,
        { files: [upload.id] }
      );

      console.log("✅ File indicizzato.");
    }

    // ✅ Crea thread
    const thread = await openai.beta.threads.create();

    // ✅ Invia messaggio testuale (il file è nel vector store!)
    await openai.beta.threads.messages.create(thread.id, {
      role: 'user',
      content: userMessage,
    });

    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: process.env.OPENAI_ASSISTANT_ID,
    });

    let runStatus;
    do {
      runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      await new Promise(r => setTimeout(r, 1000));
    } while (runStatus.status !== 'completed');

    const response = await openai.beta.threads.messages.list(thread.id);
    const reply = response.data?.[0]?.content?.[0]?.text?.value || '[Nessuna risposta]';

    return {
      statusCode: 200,
      body: JSON.stringify({ message: reply }),
    };
  } catch (err) {
    console.error("❌ Error in handler:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
