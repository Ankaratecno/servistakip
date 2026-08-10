import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Saat başı anonsu için Lovable AI ile Türkçe radyo spikeri sesi üretir. */
export const synthAnnouncement = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ text: z.string().min(1).max(400) }).parse(data))
  .handler(async ({ data }) => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("AI anahtarı bulunamadı");
    const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini-tts",
        input: data.text,
        voice: "onyx",
        response_format: "mp3",
        instructions:
          "Deep powerful male radio imaging voice, native Turkish pronunciation, dramatic and energetic, punchy FM station delivery",
      }),
    });
    if (!res.ok) {
      throw new Error(`TTS başarısız: ${res.status} ${await res.text().catch(() => "")}`);
    }
    const buf = await res.arrayBuffer();
    return { mp3: Buffer.from(buf).toString("base64") };
  });
