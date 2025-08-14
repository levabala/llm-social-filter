import { z } from 'zod';
import { openrouter } from '@openrouter/ai-sdk-provider';
import { generateObject } from 'ai';

const MatchSchema = z.object({
    intent_id: z.string(),
    match: z.boolean(),
    confidence: z.number().min(0).max(1),
    rationale: z.string().max(160),
});

const ResponseSchema = z.object({
    matches: z.array(MatchSchema).min(1).max(50),
    overall_match: z.boolean(),
});

export type Intent = {
    id: string;
    value: string;
    examplesPositive: string[];
    examplesNegative: string[];
};

function buildClassificationPrompt(post: string, intents: Intent[]): string {
    const requirementsXML = intents
        .map(
            (i) => `
    <requirement>
      <id>${i.id}</id>
      <description>${i.value}</description>
    </requirement>`,
        )
        .join('');

    return `<prompt>
  <task>
    You are a classifier. For the given post, check if it matches each of the listed requirements.
    For each requirement, return:
      - intent_id: the requirement ID
      - match: true or false
      - confidence: a number between 0 and 1 that defines the accuracy of the "match" property
      - rationale: a short explanation (max 160 characters)
    Also return overall_match: true if any match is true, otherwise false.
    Respond ONLY with valid JSON matching this schema:
    {
      "matches": [
        {
          "intent_id": "string",
          "match": true/false,
          "confidence": 0-1,
          "rationale": "string (max 160 chars)"
        }
      ],
      "overall_match": true/false
    }
  </task>
  <post>
    <text>${post}</text>
  </post>
  <requirements>
    ${requirementsXML}
  </requirements>
</prompt>`;
}

export async function checkIfPostIsImportant(post: string, intents: Intent[]) {
    console.log('checkIfPostIsImportant');
    const prompt = buildClassificationPrompt(post, intents);
    const system =
        'You are a strict multi-intent classifier. Output only JSON matching the schema.';

    console.log({ system, prompt });

    const { object, usage } = await generateObject({
        model: openrouter('google/gemini-2.5-flash'),
        schema: ResponseSchema,
        mode: 'json',
        system,
        prompt,
        temperature: 0.1,
    });

    return { result: object, usage };
}
