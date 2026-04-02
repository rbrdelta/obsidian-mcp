import Anthropic from '@anthropic-ai/sdk';

let _client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  _client = new Anthropic({ apiKey });
  return _client;
}

export interface ClassificationResult {
  title: string;
  tags: string[];
  summary: string;
}

export async function classifySection(
  header: string,
  content: string
): Promise<ClassificationResult | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: `Classify this note section. Return JSON only, no markdown fencing.

Section header: "${header}"
Content: "${content.substring(0, 1000)}"

Return:
{
  "title": "clean, descriptive title for this note",
  "tags": ["tag1", "tag2"],
  "summary": "one sentence summary"
}

Tag guidelines — use these tags when appropriate:
- personal: family, relationships, memories, children
- leadership: management, team culture, decision-making, principles
- learning: books, reading, study, education, history
- ideas: project ideas, app concepts, tools to build
- reflection: lessons learned, insights, mindset, principles
- dev: programming, code, technical work
- ai: artificial intelligence, Claude, LLMs, machine learning
- career: job, interview, professional growth
- business: startup, product, revenue, market
- finance: money, investment, budget
- pkm: knowledge management, notes, obsidian

Only return tags that clearly apply. Prefer fewer, accurate tags over many loose ones.`,
        },
      ],
    });

    let text = response.content[0].type === 'text' ? response.content[0].text : '';
    // Strip markdown code fencing if present
    text = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    const parsed = JSON.parse(text);
    return {
      title: parsed.title || header,
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      summary: parsed.summary || '',
    };
  } catch (err) {
    process.stderr.write(`[ai_classifier] Classification failed, falling back to heuristics: ${err}\n`);
    return null;
  }
}

export function isAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}
