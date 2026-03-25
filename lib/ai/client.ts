/**
 * @module ai/client
 * @description OpenRouter AI client for LifeTracker.
 *
 * Uses the OpenAI-compatible API exposed by OpenRouter so the app can switch
 * models (DeepSeek, Gemini, GPT-4o-mini, Qwen) by changing one env var
 * without touching call sites.
 *
 * Default model: `deepseek/deepseek-chat` (DeepSeek V3) — cheap and capable
 * for all structured-output tasks (macro estimation, habit analysis, etc.)
 *
 * Usage:
 *   import { aiComplete } from '@/lib/ai/client'
 *   const result = await aiComplete(systemPrompt, userPrompt)
 *
 * For streaming (AI Chat page):
 *   for await (const chunk of aiStream(system, messages)) { ... }
 */
import OpenAI from 'openai'

// OpenRouter is OpenAI-API-compatible — just change the baseURL and API key
const openrouter = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY ?? '',
  defaultHeaders: {
    'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
    'X-Title': 'LifeTracker',
  },
})

// Default model — change this to switch models without touching other code
export const DEFAULT_MODEL = process.env.OPENROUTER_DEFAULT_MODEL ?? 'deepseek/deepseek-chat'

// Available model options (for future settings UI)
export const AVAILABLE_MODELS = {
  'deepseek/deepseek-chat': 'DeepSeek V3 (Cheapest)',
  'google/gemini-flash-1.5': 'Gemini Flash 1.5 (Fast)',
  'openai/gpt-4o-mini': 'GPT-4o Mini (Reliable)',
  'qwen/qwen-2.5-72b-instruct': 'Qwen 2.5 72B',
} as const

// ─── Core completion helper ───────────────────────────────────────────────────

interface AICallOptions {
  model?: string
  temperature?: number
  maxTokens?: number
}

export async function aiComplete(
  systemPrompt: string,
  userPrompt: string,
  options: AICallOptions = {}
): Promise<string> {
  const response = await openrouter.chat.completions.create({
    model: options.model ?? DEFAULT_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 600,
  })

  return response.choices[0]?.message?.content ?? ''
}

// ─── Streaming completion (for AI Chat) ──────────────────────────────────────

export async function* aiStream(
  systemPrompt: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
  options: AICallOptions = {}
): AsyncGenerator<string> {
  const stream = await openrouter.chat.completions.create({
    model: options.model ?? DEFAULT_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages,
    ],
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 800,
    stream: true,
  })

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content
    if (delta) yield delta
  }
}

export { openrouter }
