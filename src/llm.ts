import { z } from 'zod';
import { openrouter } from '@openrouter/ai-sdk-provider';
import { generateObject } from 'ai';

const MatchSchemaGen = z.object({
    intent_id: z.string(),
    match: z.boolean(),
    confidence: z.number(),
    rationale: z.string(),
});

const ResponseSchemaGen = z.object({
    matches: z.array(MatchSchemaGen),
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
      <positive_examples>
        ${i.examplesPositive.map(ex => `<example>${ex}</example>`).join('\n        ')}
      </positive_examples>
      <negative_examples>
        ${i.examplesNegative.map(ex => `<example>${ex}</example>`).join('\n        ')}
      </negative_examples>
    </requirement>`,
        )
        .join('');

    return `<prompt>
  <task>
    You are a classifier. For the given post, check if it matches each of the listed requirements.
    Return matches only for intents present in <requirements>. Keep matches length <= 50.
    For each requirement, return:
      - intent_id: the requirement ID
      - match: true or false
      - match_number: a number between 0 and 1 as a fractional number value of "match"
      - rationale: a short explanation
    
    Use the positive and negative examples provided for each requirement to better understand what should and should not match.
    Positive examples show content that SHOULD match the requirement.
    Negative examples show content that should NOT match the requirement.
    
    Also return overall_match: true if any match is true, otherwise false.
    Respond ONLY with valid JSON.
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
    const prompt = buildClassificationPrompt(post, intents);
    const system =
        'You are a strict multi-intent classifier. Output only JSON with fields: matches, overall_match.';

    console.log({ system, prompt });

    const { object, usage } = await generateObject({
        model: openrouter('google/gemini-2.5-flash'),
        schema: ResponseSchemaGen,
        mode: 'json',
        system,
        prompt,
        temperature: 0.1,
        maxOutputTokens: 2000
    });

    const strict = ResponseSchemaGen.parse(object);
    return { result: strict, usage };
}
