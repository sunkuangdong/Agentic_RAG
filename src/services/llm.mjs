import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';

const model = new ChatOpenAI({
    model: process.env.OPENAI_MODEL,
    temperature: 0,
    configuration: {
        apiKey: process.env.OPENAI_API_KEY,
        baseURL: process.env.OPENAI_BASE_URL,
    },
});

const embeddings = new OpenAIEmbeddings({
    model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
    dimensions: 768,
    configuration: {
        apiKey: process.env.OPENAI_API_KEY,
        baseURL: process.env.OPENAI_BASE_URL,
    },
});

export { model, embeddings };