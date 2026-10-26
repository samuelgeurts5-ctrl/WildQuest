export async function onRequestPost({ request, env }) {
  if (!env.GROQ_API_KEY) {
    return json({ error: "The server's GROQ_API_KEY secret has not been configured yet." }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Please upload an image in a supported format." }, 400);
  }

  const image = body?.image;
  if (typeof image !== "string") {
    return json({ error: "No image was provided." }, 400);
  }

  const match = image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    return json({ error: "Use a JPG, PNG, or WebP image." }, 400);
  }
  if (image.length > 7_000_000) {
    return json({ error: "Image is too large. Please use an image under 5 MB." }, 413);
  }

  const prompt = `You are helping with a community biodiversity observation project. Carefully inspect the uploaded image and give a cautious preliminary identification. Do not pretend certainty, and do not claim that you are a scientist or that this is a verified record. If the image is unclear or lacks enough detail, say so. Do not infer exact location from the image. Use this format:
Likely identification: [common name, or "uncertain"]
Possible scientific name: [name if reasonably supported, otherwise "uncertain"]
Confidence: [low, medium, or high]
Visible clues: [briefly describe observable features]
Similar possibilities: [alternatives if relevant]
Next step: [what additional photo/detail would help]
Remind the user that an AI suggestion needs human verification before being treated as research data.`;

  try {
    const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "qwen/qwen3.8-27b",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: image } }
          ]
        }],
        temperature: 0.2,
        max_completion_tokens: 700
      })
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return json({
        error: upstream.status === 401 || upstream.status === 403
          ? "Groq rejected the server key. Check that the GROQ_API_KEY secret is correct."
          : "The AI provider could not complete the identification. Please try again later."
      }, 502);
    }

    const identification = data?.choices?.[0]?.message?.content;
    if (typeof identification !== "string" || !identification.trim()) {
      return json({ error: "The AI returned an empty result. Please try another photo." }, 502);
    }
    return json({ identification });
  } catch {
    return json({ error: "Could not reach the AI service. Please try again later." }, 502);
  }
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
