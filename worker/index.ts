/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  YANDEX_CLOUD_FOLDER_ID?: string;
  YANDEX_CLOUD_API_KEY?: string;
  YANDEX_CLOUD_IAM_TOKEN?: string;
  LLM_RELAY_URL?: string;
  LLM_RELAY_TOKEN?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const runtimeProcess = Reflect.get(globalThis, "process") as { env?: Record<string, string | undefined> } | undefined;
    const names = ["OPENROUTER_API_KEY", "OPENROUTER_MODEL", "YANDEX_CLOUD_FOLDER_ID", "YANDEX_CLOUD_API_KEY", "YANDEX_CLOUD_IAM_TOKEN", "LLM_RELAY_URL", "LLM_RELAY_TOKEN"] as const;
    const values = Object.fromEntries(names.map((name) => [name, runtimeProcess?.env?.[name] || env?.[name]]));
    Reflect.set(globalThis, Symbol.for("pobeg.runtime.env"), values);
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
