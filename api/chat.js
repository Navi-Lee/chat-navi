import https from "https";

export const config = {
  runtime: "nodejs",
  maxDuration: 60
};

const API_HOST = "maas-api.cn-huabei-1.xf-yun.com";
const API_PATH = "/v2/chat/completions";
const MODEL_NAME = "xop3qwen1b7";

const setCorsHeaders = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
};

const setSseHeaders = (res) => {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
};

const readJsonBody = (req) =>
  new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", reject);
  });

const writeSseError = (res, message) => {
  if (!res.headersSent) {
    res.statusCode = 200;
    setSseHeaders(res);
  }

  res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
};

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST, OPTIONS");
    res.end("Method Not Allowed");
    return;
  }

  const apiKey = process.env.XUNFEI_API_KEY;
  if (!apiKey) {
    writeSseError(res, "Missing XUNFEI_API_KEY on server");
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Invalid JSON body" }));
    return;
  }

  const { messages } = payload || {};
  if (!Array.isArray(messages)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "messages must be an array" }));
    return;
  }

  const requestBody = {
    model: MODEL_NAME,
    messages,
    max_tokens: 4000,
    temperature: 0.7,
    stream: true
  };

  const options = {
    hostname: API_HOST,
    port: 443,
    path: API_PATH,
    method: "POST",
    timeout: 30000,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": "Node.js-Client",
      Accept: "*/*"
    }
  };

  const upstreamReq = https.request(options, (upstreamRes) => {
    setSseHeaders(res);

    if (upstreamRes.statusCode && upstreamRes.statusCode >= 400) {
      const status = upstreamRes.statusCode;
      upstreamRes.resume();
      writeSseError(res, `Upstream error: ${status}`);
      return;
    }

    upstreamRes.pipe(res);
  });

  upstreamReq.on("error", (error) => {
    writeSseError(res, `Stream request failed: ${error.message}`);
  });

  upstreamReq.on("timeout", () => {
    upstreamReq.destroy();
    writeSseError(res, "Upstream request timed out");
  });

  req.on("close", () => {
    upstreamReq.destroy();
  });

  upstreamReq.write(JSON.stringify(requestBody));
  upstreamReq.end();
}
