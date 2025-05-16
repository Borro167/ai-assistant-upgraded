import { IncomingForm } from 'formidable';
import fs from 'fs';
import { Readable } from 'stream';
import OpenAI from 'openai';

// Inizializza OpenAI client (API KEY da variabile ambiente Netlify)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Funzione per adattare l'evento Netlify a una request stream (necessario per formidable)
function buildReadableRequest(event) {
  const buffer = Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8');
  const readable = Readable.from([buffer]);
  readable.headers = event.headers;
  readable.method = event.httpMethod;
  readable.url = '/';
  return readable;
}

// Parsing del form-data (messaggio + file) con formidable
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
    // 1. Parsing dati ricevuti dal frontend
    const req = buildReadableRequest(event);
    const { fields, files } = await parseFormData(req);

    // 2. Estrai messaggio utente e file
    const userMessage = Array.isArray(fields.message)
      ? fields.message[0]
      : fields.message || '';
    const threadId = fields.threadId || null;
    const file = Array.isArray(files.file) ? files.file[0] : files.file;

    // 3. Crea thread se necessario
    const thread = threadId ? { id: threadId } : await openai.beta.threads.create();

    // 4. Se presente, carica file su OpenAI e ottieni fileId
    let fileId = null;
    if (file && file.filepath) {
      const upload = await openai.files.create({
        file: fs.createReadStream(file.filepath),
        purpose: 'assistants'
      });
      fileId = upload.id;

      // (Opzionale) Indicizza file su vector store se usi questa funzione
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

    // 5. Prepara il payload, ATTENZIONE: content DEVE essere [{type:"text", text:...}]
    const messagePayload = {
      role: 'user',
      content: [
        {
          type: "text",
          text: userMessage // Deve essere text, NON value
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

    // 6. Invia il messaggio all'assistant
    await openai.beta.threads.messages.create(thread.id, messagePayload);

    // 7. Avvia il run dell'assistant
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: process.env.OPENAI_ASSISTANT_ID,
    });

    // 8. Attendi il completamento del run (polling ogni 1s)
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

    // 9. Estrai la risposta assistant
    const messagesResponse = await openai.beta.threads.messages.list(thread.id);
    const lastAssistantMsg = messagesResponse.data.find(m => m.role === "assistant") || messagesResponse.data[0] || { content: [] };

    const textReply = lastAssistantMsg.content
      ?.filter(c => c.type === 'text')
      ?.map(c => c.text?.value || c.text)
      ?.join('\n')
      ?.trim() || '[Nessuna risposta generata]';

    // 10. Risposta al frontend
    return {
      statusCode: 200,
      body: JSON.stringify({
        threadId: thread.id,
        message: textReply
      })
    };
  } catch (err) {
    // Logging dettagliato errori
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
