// server.js
// Express backend for Angeles Animal Care Hospital
// NOTE: Gemini pre-assessment is now called directly from the frontend.
//       This server now only handles the OpenRouter general chat endpoint
//       (used by any legacy chat widget) and can be extended as needed.
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

app.use(cors({
  origin: [
    'https://vet-care-hospital.netlify.app',
    'http://localhost:5173',
    'http://localhost:3000',
  ],
}));
app.use(express.json());

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── General chat endpoint (OpenRouter) ───────────────────────────────────────
// Used by any legacy chat widget that still calls the server.
app.post('/api/chat', async (req, res) => {
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: 'Question is required' });
  if (!process.env.OPENROUTER_API_KEY)
    return res.status(500).json({ error: 'OpenRouter API key not configured' });

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://vet-care-hospital.netlify.app',
        'X-Title': 'Angeles Animal Care Hospital',
      },
      body: JSON.stringify({
        model: 'openrouter/auto',
        messages: [
          {
            role: 'system',
            content: `You are a helpful pet care assistant for Angeles Animal Care Hospital.
Answer questions about pet health, nutrition, vaccines, emergencies, and clinic info.
Be concise, clear, and always recommend consulting a vet for serious concerns.`,
          },
          { role: 'user', content: question },
        ],
      }),
    });

    const data = await response.json();
    if (!response.ok)
      return res.status(response.status).json({ error: data?.error?.message || 'API error' });

    const text = data.choices?.[0]?.message?.content;
    if (!text) return res.status(500).json({ error: 'No response from AI model' });

    res.json({ content: [{ text }] });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Pre-assessment endpoint (server-side Gemini fallback) ─────────────────────
// The frontend now calls Gemini directly via VITE_GEMINI_API_KEY.
// This endpoint remains as a fallback for server-side use cases
// (e.g. saving assessments server-side, or if the frontend key is unavailable).
app.post('/api/pre-assess', async (req, res) => {
  const { petName, petType, petAge, symptoms, additionalNotes } = req.body;

  if (!symptoms || symptoms.trim().length < 5)
    return res.status(400).json({ error: "Please describe your pet's symptoms." });

  if (!process.env.GEMINI_API_KEY)
    return res.status(500).json({ error: 'Gemini API key not configured on server' });

  const prompt = `
You are a veterinary triage assistant for Angeles Animal Care Hospital. A pet owner has described their pet's symptoms.

Pet Details:
- Name: ${petName || 'Unknown'}
- Type: ${petType || 'Unknown'}
- Age: ${petAge || 'Unknown'}
- Symptoms: ${symptoms}
- Additional Notes: ${additionalNotes || 'None'}

Analyze the symptoms and respond ONLY with a valid JSON object (no markdown, no backticks, no extra text) in this exact format:
{
  "conditions": ["possible condition 1", "possible condition 2", "possible condition 3"],
  "urgency": "Emergency" | "High" | "Moderate" | "Low",
  "urgencyReason": "Brief explanation of urgency level in 1-2 sentences",
  "recommendedService": "General Check-up" | "Emergency Care" | "Vaccination" | "Dental Care" | "Surgery Consultation" | "Dermatology" | "Laboratory/Diagnostics" | "Grooming" | "Follow-up",
  "summary": "A 2-3 sentence plain-language summary of what might be happening and what to do next",
  "warningSigns": ["sign to watch for 1", "sign to watch for 2"],
  "homeCareTips": ["tip 1 if low urgency", "tip 2"],
  "appointment_notes": "brief notes for the appointment form"
}

Rules:
- urgency "Emergency" means go to the vet NOW (life-threatening)
- urgency "High" means see a vet today
- urgency "Moderate" means see a vet within 1-2 days
- urgency "Low" means monitor at home, routine visit okay
- conditions should be plausible differentials, not diagnoses
- Always recommend professional vet consultation
- Keep all text concise and non-alarming unless truly urgent
`.trim();

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('Gemini error:', data);
      return res.status(response.status).json({ error: data?.error?.message || 'Gemini API error' });
    }

    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) return res.status(500).json({ error: 'No response from Gemini' });

    const cleaned = rawText.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error('JSON parse error. Raw:', rawText);
      return res.status(500).json({ error: 'AI returned invalid format. Please try again.' });
    }

    res.json(parsed);
  } catch (err) {
    console.error('Pre-assess error:', err);
    res.status(500).json({ error: err.message });
  }
}); 

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));