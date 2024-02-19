import { kv } from '@vercel/kv'
import { OpenAIStream, StreamingTextResponse } from 'ai'
import OpenAI from 'openai'

import { auth } from '@/auth'
import { nanoid } from '@/lib/utils'

export const runtime = 'edge'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

export async function POST(req: Request) {
  const json = await req.json()
  const { messages, previewToken } = json
  console.log((await auth()));
  const userEmail = (await auth())?.user.email

  if (!userEmail) {
    return new Response('Unauthorized', {
      status: 401
    })
  }

  if (previewToken) {
    openai.apiKey = previewToken
  }

  const options = {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      Authorization: process.env.CORCEL_API_KEY || ""
    },
    body: JSON.stringify({
      model: 'cortext-ultra',
      stream: true,
      miners_to_query: 1,
      top_k_miners_to_query: 40,
      ensure_responses: true,
      messages
    })
  }

  const res = await fetch('https://api.corcel.io/cortext/text', options);

  // const res = await openai.chat.completions.create({
  //   model: 'gpt-3.5-turbo',
  //   messages,
  //   temperature: 0.7,
  //   stream: true
  // })

  const stream = OpenAIStream(res, {
    async onCompletion(completion) {
      const title = json.messages[0].content.substring(0, 100)
      const id = json.id ?? nanoid()
      const createdAt = Date.now()
      const path = `/chat/${id}`
      const payload = {
        id,
        title,
        userEmail,
        createdAt,
        path,
        messages: [
          ...messages,
          {
            content: completion,
            role: 'assistant'
          }
        ]
      }
      await kv.hmset(`chat:${id}`, payload)
      await kv.zadd(`user:chat:${userEmail}`, {
        score: createdAt,
        member: `chat:${id}`
      })
    }
  })

  return new StreamingTextResponse(stream)
}
