import { IncomingForm } from 'formidable';
import fs from 'fs';
import { Readable } from 'stream';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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
    const { files } = await parseFormData(req);

    const file = files.file;

    if (file && file.filepath) {
      const upload = await openai.files.create({
        file: fs.createReadStream(file.filepath),
        purpose: 'assistants',
      });

      console.log("✅ File caricato su OpenAI:", upload.id, file.originalFilename);

      return {
        statusCode: 200,
        body: JSON.stringify({
          fileId: upload.id,
          fileName: file.originalFilename,
        }),
      };
    }

    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Nessun file ricevuto" }),
    };

  } catch (err) {
    console.error('❌ Errore durante l’upload del file:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
