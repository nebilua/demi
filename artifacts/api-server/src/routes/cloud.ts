import { Router, type IRouter } from "express";

const router: IRouter = Router();
const MAX_INPUT_CHARS = 1_800;
const MAX_OUTPUT_CHARS = 6_000;
const REQUEST_TIMEOUT_MS = 20_000;

type CloudTask = "chat" | "research";

function providerConfigured() {
  return (
    process.env["CLOUD_INFERENCE_PROVIDER"] === "openai-compatible" &&
    Boolean(process.env["CLOUD_INFERENCE_API_KEY"])
  );
}

function configuredBaseUrl() {
  return (
    process.env["CLOUD_INFERENCE_BASE_URL"] ??
    "https://api.openai.com/v1/chat/completions"
  );
}

function isTask(value: unknown): value is CloudTask {
  return value === "chat" || value === "research";
}

function isReason(value: unknown) {
  return (
    value === "local-engine-unavailable" ||
    value === "device-budget-exceeded" ||
    value === "local-runtime-failure"
  );
}

function providerError(res: Parameters<Parameters<IRouter["post"]>[1]>[1], status: number, code: string, message: string) {
  return res.status(status).json({ code, message });
}

router.get("/cloud/inference/status", (_req, res) => {
  res.json({
    provider: "openai-compatible",
    configured: providerConfigured(),
    message: providerConfigured()
      ? "A server-managed cloud provider is configured."
      : "No server-managed cloud provider is configured.",
  });
});

router.post("/cloud/inference", async (req, res) => {
  if (!providerConfigured()) {
    return providerError(
      res,
      503,
      "unavailable",
      "No server-managed cloud provider is configured.",
    );
  }

  const body = req.body as { task?: unknown; reason?: unknown; input?: unknown };
  if (
    !isTask(body.task) ||
    !isReason(body.reason) ||
    typeof body.input !== "string" ||
    !body.input.trim() ||
    body.input.length > MAX_INPUT_CHARS
  ) {
    return providerError(
      res,
      400,
      "invalid-request",
      "The cloud request was missing a bounded task input.",
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const upstream = await fetch(configuredBaseUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env["CLOUD_INFERENCE_API_KEY"]}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: process.env["CLOUD_INFERENCE_MODEL"] ?? "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Answer only the bounded user request. Do not infer or request private context that was not provided. Be concise and honest about uncertainty.",
          },
          { role: "user", content: body.input.trim() },
        ],
        max_tokens: 1_200,
        temperature: 0.2,
      }),
      signal: controller.signal,
    });

    if (upstream.status === 429) {
      return providerError(
        res,
        429,
        "quota",
        "The configured cloud provider quota is unavailable.",
      );
    }
    if (upstream.status === 401 || upstream.status === 403 || upstream.status >= 500) {
      return providerError(
        res,
        503,
        "unavailable",
        "The configured cloud provider is unavailable.",
      );
    }
    if (!upstream.ok) {
      return providerError(
        res,
        502,
        "provider-failed",
        `The cloud provider returned HTTP ${upstream.status}.`,
      );
    }

    const responseBody = (await upstream.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const output = responseBody.choices?.[0]?.message?.content;
    if (typeof output !== "string" || !output.trim()) {
      return providerError(
        res,
        502,
        "provider-failed",
        "The cloud provider returned no usable text.",
      );
    }
    return res.json({ output: output.trim().slice(0, MAX_OUTPUT_CHARS) });
  } catch (error) {
    if (controller.signal.aborted) {
      return providerError(
        res,
        408,
        "timeout",
        "The cloud provider took too long to respond.",
      );
    }
    req.log?.warn({ err: error, task: body.task }, "Cloud provider request failed");
    return providerError(
      res,
      502,
      "provider-failed",
      "The cloud provider request failed.",
    );
  } finally {
    clearTimeout(timeout);
  }
});

export default router;