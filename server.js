import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

// Manual CORS - bypass any proxy restrictions
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/pre-assess', async (req, res) => {
  const { petName, petType, petAge, symptoms, additionalNotes } = req.body;

  if (!symptoms || symptoms.trim().length < 5)
    return res.status(400).json({ error: "Please describe your pet's symptoms." });

  if (!process.env.GEMINI_API_KEY)
    return res.status(500).json({ error: 'Gemini API key not configured on server' });

  const prompt = `You are a veterinary triage assistant for Angeles Animal Care Hospital.
Pet: ${petName || 'Unknown'} (${petType || 'Unknown'}, ${petAge || 'Unknown'})
Symptoms: ${symptoms}
Additional Notes: ${additionalNotes || 'None'}

Respond ONLY with valid JSON (no markdown):
{
  "conditions": ["condition1", "condition2"],
  "urgency": "Emergency|High|Moderate|Low",
  "urgencyReason": "explanation",
  "recommendedService": "General Check-up|Emergency Care|Vaccination|Dental Care|Surgery Consultation|Dermatology|Laboratory/Diagnostics|Grooming|Follow-up",
  "summary": "2-3 sentence summary",
  "warningSigns": ["sign1", "sign2"],
  "homeCareTips": ["tip1", "tip2"],
  "appointment_notes": "brief notes"
}`;

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
    if (!response.ok) return res.status(response.status).json({ error: data?.error?.message || 'Gemini API error' });

    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) return res.status(500).json({ error: 'No response from Gemini' });

    const cleaned = rawText.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    res.json(parsed);
  } catch (err) {
    console.error('Pre-assess error:', err);
    res.status(500).json({ error: err.message });
  }
});

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
          { role: 'system', content: 'You are a helpful pet care assistant for Angeles Animal Care Hospital.' },
          { role: 'user', content: question },
        ],
      }),
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data?.error?.message || 'API error' });
    const text = data.choices?.[0]?.message?.content;
    if (!text) return res.status(500).json({ error: 'No response from AI model' });
    res.json({ content: [{ text }] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
