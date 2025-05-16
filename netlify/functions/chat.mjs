import { IncomingForm } from 'formidable';
import fs from 'fs';
import { Readable } from 'stream';
import OpenAI from 'openai';

// Inizializza OpenAI client (API KEY da Netlify env)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Adatta evento Netlify a request stream (per formidable)
function buildReadableRequest(event) {
  const buffer = Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8');
  const readable = Readable.from([buffer]);
  readable.headers = event.headers;
  readable.method = event.httpMethod;
  readable.url = '/';
  return readable;
}

// Parsing form-data (messaggio + file) con formidable
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
    // 1. Parsing dati da frontend
    const req = buildReadableRequest(event);
    const { fields, files } = await parseFormData(req);

    // 2. Estrai messaggio utente e file
    const userMessageRaw = Array.isArray(fields.message)
      ? fields.message[0]
      : fields.message;

    // 3. Carica file se presente
    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    let fileId = null;
    if (file && file.filepath) {
      const upload = await openai.files.create({
        file: fs.createReadStream(file.filepath),
        purpose: 'assistants'
      });
      fileId = upload.id;

      // (Opzionale) Indicizza file in vector store se serve
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

    // 4. Genera messaggio sicuro (mai vuoto)
    const safeMessage = (typeof userMessageRaw === "string" && userMessageRaw.trim())
      ? userMessageRaw.trim()
      : (fileId ? "Ecco il file allegato." : "Messaggio vuoto.");

    const threadId = fields.threadId || null;
    const thread = threadId ? { id: threadId } : await openai.beta.threads.create();

    // 5. Costruisci payload: content sempre [{type:"text", text:...}]
    const messagePayload = {
      role: 'user',
      content: [
        {
          type: "text",
          text: safeMessage
        }
      ],
      ...(fileId && {
        attachments: [
          {
            file_id: fileId,
            tools: [
              { type: "code_interpreter" },
              { type: "file_search" }
            ]
          }
        ]
      })
    };

    // 6. Invia messaggio all'assistant
    await openai.beta.threads.messages.create(thread.id, messagePayload);

    // 7. Avvia run assistant
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: process.env.OPENAI_ASSISTANT_ID,
    });

    // 8. Polling finché non è completato
    let runStatus;
    do {
      runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      await new Promise((res) => setTimeout(res, 1000));
    } while (
      runStatus.status !== 'completed' &&
      runStatus.status !== 'failed' &&
      runStatus.status !== 'cancelled'
    );

    if (runStatus.status !== 'completed') {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: `Assistant run failed: ${runStatus.status}` })
      };
    }

    // 9. Recupera risposta assistant (estrattore robusto)
    const messagesResponse = await openai.beta.threads.messages.list(thread.id);
    console.log('MESSAGES RESPONSE:', JSON.stringify(messagesResponse.data, null, 2)); // DEBUG

    let textReply = '[Nessuna risposta generata]';
    if (Array.isArray(messagesResponse.data)) {
      // Trova tutti i messaggi di ruolo assistant
      const assistants = messagesResponse.data.filter(m => m.role === "assistant");
      for (const msg of assistants) {
        if (Array.isArray(msg.content)) {
          const text = msg.content
            .filter(c => c.type === 'text')
            .map(c => (typeof c.text === 'string' ? c.text : (c.text?.value || '')))
            .filter(Boolean)
            .join('\n')
            .trim();
          if (text) {
            textReply = text;
            break;
          }
        }
      }
    }

    // 10. Risposta al frontend
    return {
      statusCode: 200,
      body: JSON.stringify({
        threadId: thread.id,
        message: textReply
      })
    };
  } catch (err) {
    // Logging errori dettagliati
    console.error('❌ Error in handler:', err);
    if (err.response && err.response.data) {
      console.error('OpenAI API response:', err.response.data);
    }
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: err.message,
        details: err.response?.data,
      }),
    };
  }
};
