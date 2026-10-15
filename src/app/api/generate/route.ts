import { NextResponse } from "next/server";
import { BriefSchema } from "@/lib/validation";
import { generateCourse, STAGES } from "@/lib/ai/pipeline";
import { sessionTokenFromRequest, userFromToken } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * A local model can be silent for minutes inside one stage. Without bytes on
 * the wire, client and proxy idle timeouts sever the response mid-generation.
 */
const HEARTBEAT_MS = 15_000;

export async function POST(request: Request) {
  // A generated course belongs to an account — an anonymous request has
  // nobody to attach it (or its provider spend) to.
  const user = await userFromToken(sessionTokenFromRequest(request));
  if (!user) {
    return NextResponse.json({ error: "Sign in to generate a course" }, { status: 401 });
  }

  let brief;
  try {
    brief = BriefSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid brief" },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;

      // A dropped client must not abort generation. Once enqueue fails the
      // stream is gone: stop writing, but let the pipeline finish so the
      // course lands in the database instead of half-built at the stage it
      // was on (the bug that left `analyze` stuck at "running").
      const send = (payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        } catch {
          closed = true;
        }
      };

      const heartbeat = setInterval(() => send({ type: "ping" }), HEARTBEAT_MS);

      send({ type: "plan", stages: STAGES.map((s) => ({ id: s.id, label: s.label, detail: s.detail })) });

      try {
        const result = await generateCourse(brief, (evt) => send({ type: "stage", ...evt }), request);
        send({ type: "done", ...result });
      } catch (error) {
        send({
          type: "error",
          message: error instanceof Error ? error.message : "Generation failed",
        });
      } finally {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // Already errored/closed by the consumer going away.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
