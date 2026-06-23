import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';

const model = new ChatOpenAI({
    model: process.env.OPENAI_MODEL || process.env.MODEL_NAME,
    temperature: 0,
    configuration: {
        apiKey: process.env.OPENAI_API_KEY,
        baseURL: process.env.OPENAI_BASE_URL,
    },
});

// Embedding 与 Chat 分离：检索向量走 Ollama，与建库时 nomic-embed-text @ 768 一致
const embeddings = new OpenAIEmbeddings({
    model: process.env.OPENAI_EMBEDDING_MODEL || process.env.EMBEDDINGS_MODEL_NAME || 'nomic-embed-text',
    dimensions: Number(process.env.OPENAI_EMBEDDING_DIMENSIONS) || 768,
    configuration: {
        apiKey: process.env.OPENAI_EMBEDDING_API_KEY || process.env.OLLAMA_API_KEY || 'ollama-local-key',
        baseURL: process.env.OPENAI_EMBEDDING_BASE_URL || process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
    },
});

export { model, embeddings };