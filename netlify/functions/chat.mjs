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
    console.log('--- STEP 1: Ricevuta richiesta dal frontend');
    const req = buildReadableRequest(event);
    const { fields, files } = await parseFormData(req);
    console.log('--- STEP 2: Parsed fields:', fields);
    console.log('--- STEP 3: Parsed files:', files);

    const userMessageRaw = Array.isArray(fields.message)
      ? fields.message[0]
      : fields.message;
    const file = Array.isArray(files.file) ? files.file[0] : files.file;

    let fileId = null;
    if (file && file.filepath) {
      console.log('--- STEP 4: Upload file verso OpenAI...');
      const upload = await openai.files.create({
        file: fs.createReadStream(file.filepath),
        purpose: 'assistants'
      });
      fileId = upload.id;
      console.log('--- STEP 4b: File caricato su OpenAI con id:', fileId);

      // (Opzionale) Indicizza file su vector store
      if (
        openai.beta?.vectorStores?.fileBatches?.uploadAndPoll &&
        process.env.OPENAI_VECTOR_STORE_ID
      ) {
        console.log('--- STEP 4c: Indicizzazione vector store...');
        await openai.beta.vectorStores.fileBatches.uploadAndPoll(
          process.env.OPENAI_VECTOR_STORE_ID,
          { files: [fileId] }
        );
        console.log('--- STEP 4d: Indicizzazione vector store completata.');
      }
    }

    const safeMessage = (typeof userMessageRaw === "string" && userMessageRaw.trim())
      ? userMessageRaw.trim()
      : (fileId ? "Ecco il file allegato." : "Messaggio vuoto.");

    const threadId = fields.threadId || null;
    const thread = threadId ? { id: threadId } : await openai.beta.threads.create();
    console.log('--- STEP 5: Thread creato/recuperato:', thread.id);

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
    console.log('--- STEP 6: Payload preparato:', messagePayload);

    await openai.beta.threads.messages.create(thread.id, messagePayload);
    console.log('--- STEP 7: Messaggio inviato a OpenAI.');

    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: process.env.OPENAI_ASSISTANT_ID,
    });
    console.log('--- STEP 8: Run assistant creato:', run.id);

    // Polling finché non è completato
    let runStatus;
    let tentativi = 0;
    do {
      runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      console.log(`--- STEP 9: Polling run status: ${runStatus.status} (tentativo ${++tentativi})`);
      await new Promise((res) => setTimeout(res, 1000));
    } while (
      runStatus.status !== 'completed' &&
      runStatus.status !== 'failed' &&
      runStatus.status !== 'cancelled'
    );

    if (runStatus.status !== 'completed') {
      console.error('--- STEP 10: Run assistant NON completato:', runStatus.status);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: `Assistant run failed: ${runStatus.status}` })
      };
    }

    const messagesResponse = await openai.beta.threads.messages.list(thread.id);
    console.log('--- STEP 11: MESSAGES RESPONSE:', JSON.stringify(messagesResponse.data, null, 2));

    // Trova sempre il PRIMO messaggio assistant con testo valido
    let textReply = '[Nessuna risposta generata]';
    if (Array.isArray(messagesResponse.data)) {
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

    console.log('--- STEP 12: textReply finale:', textReply);

    return {
      statusCode: 200,
      body: JSON.stringify({
        threadId: thread.id,
        message: textReply
      })
    };
  } catch (err) {
    console.error('❌ ERROR HANDLER:', err);
    if (err.response && err.response.data) {
      console.error('❌ OpenAI API response:', err.response.data);
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
