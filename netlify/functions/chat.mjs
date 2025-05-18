import { OpenAI } from "openai";
import multipart from "parse-multipart";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const handler = async (event) => {
  try {
    console.log("event.headers:", event.headers);

    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: "Method not allowed" }),
      };
    }

    const contentType =
      event.headers["content-type"] ||
      event.headers["Content-Type"] ||
      "";
    console.log("Detected content-type:", contentType);

    let message = "";
    let fileIds = [];

    if (contentType && contentType.includes("multipart/form-data")) {
      const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
      if (!boundaryMatch) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: "Boundary mancante", contentType }),
        };
      }
      const cleanBoundary = boundaryMatch[1];
      console.log("Boundary trovato:", cleanBoundary);

      // 👇 AGGIUNGI QUESTO CONTROLLO!
      if (!event.isBase64Encoded) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: "Body non in base64 (flag isBase64Encoded false)",
          }),
        };
      }

      const bodyBuffer = Buffer.from(event.body, "base64");
      console.log("Body buffer length:", bodyBuffer.length);
      console.log("Body preview:", bodyBuffer.toString("utf8", 0, 200));

      let parts;
      try {
        parts = multipart.Parse(bodyBuffer, cleanBoundary);
      } catch (parseErr) {
        console.error("Multipart Parse Error:", parseErr, bodyBuffer.toString());
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: "Errore nel parsing multipart: " + parseErr.message,
          }),
        };
      }

      console.log("Parts trovate:", parts);

      let filePart = parts.find((p) => p.filename);
      let messagePart = parts.find((p) => p.name === "message");

      if (filePart && filePart.data) {
        const uploaded = await openai.files.create({
          file: Buffer.from(filePart.data),
          filename: filePart.filename,
          purpose: "assistants",
        });
        fileIds.push(uploaded.id);
      }

      message =
        messagePart && messagePart.data
          ? messagePart.data.toString()
          : "";

      if (!message && !filePart) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: "Richiesta vuota: manca messaggio e file.",
          }),
        };
      }
    } else if (contentType && contentType.includes("application/json")) {
      const body = JSON.parse(event.body);
      message = body.message || "";
      if (!message) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: "Nessun messaggio nel body.",
          }),
        };
      }
    } else {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "Content-Type non supportato",
          contentType,
        }),
      };
    }

    // --- (RESTO DEL FLUSSO UGUALE A PRIMA) ---

    // ... assistant thread/response logic qui sotto come sopra

  } catch (err) {
    // LOG DELL'ERRORE COMPLETO
    console.error("FATAL ERROR:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || "Errore interno." }),
    };
  }
};
