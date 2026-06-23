import { Milvus } from '@langchain/community/vectorstores/milvus';
import { embeddings } from './llm.mjs';
import { COLLECTION_NAME, TOP_K } from '../config/rag.mjs';
import { detectQuestionLanguage } from '../utils/language.mjs';

// Cache the database instance to implement the Singleton pattern
let vectorStore = null;

/**
 * Get or initialize the Milvus vector database instance
 * @returns {Promise<Milvus>} 
 */
async function getVectorStore(question) {
    if (vectorStore) {
        return vectorStore;
    }

    console.log('Connecting to Milvus database...');

    try {
        vectorStore = await Milvus.fromExistingCollection(
            embeddings, 
            {
                collectionName: COLLECTION_NAME,
                url: process.env.MILVUS_URL || "http://localhost:19530",
                vectorField: "vector",
                textField: "content",
                primaryField: "id",
                indexCreateOptions: {
                    metric_type: "COSINE",
                    index_type: "HNSW",
                    params: {
                        m: 16,
                        ef_construction: 200,
                    },
                    search_params: {
                        ef: 64,
                    },
                },
            }
        );
        // To avoid the error: "Invalid search params: invalid json string"
        vectorStore.indexSearchParams = {
            metric_type: "COSINE",
            params: JSON.stringify({ ef: 64 }),
        }
        // To avoid the error: "Invalid search params: invalid json string"
        console.log('Successfully connected to Milvus database!');
    
        try {
            await vectorStore.client.loadCollection({ collection_name: COLLECTION_NAME });
            console.log(`✓ Collection ${COLLECTION_NAME} is loaded\n`);
        } catch (error) {
            if (!error.message.includes("already loaded")) {
                throw error;
            }
            console.log(`✓ Collection ${COLLECTION_NAME} is already loaded\n`);
        }
        console.log("=".repeat(100));
        console.log("question: ", question);
        console.log("=".repeat(100));
        return vectorStore;
    } catch (error) {
        console.error('Failed to connect to Milvus database:', error);
        throw error;
    }
}

function mergeUnique (existingDocs, newDocs) {
    const map = new Map();
    for ( const d of [...existingDocs, ...newDocs]) {
        const key = String(d.id);
        const prev = map.get(key);
        if (!prev || Number(d.score) > Number(prev.score)) {
            map.set(key, d);
        }
    }
    return Array.from(map.values()).sort((a, b) => Number(b.score) - Number(a.score));
}

async function retrieveRelevantContent(question, k = TOP_K) {
    try {
        // Ensure the database instance is retrieved before searching
        const store = await getVectorStore(question);
        const docsWithScores = await store.similaritySearchWithScore(question, k);
        
        return docsWithScores.map(([doc, score]) => ({
            score,
            content: doc.pageContent,
            id: doc.metadata?.id ?? "unknown",
            bookId: doc.metadata?.book_id ?? "unknown",
            chapter_num: doc.metadata?.chapter_num ?? "unknown",
            index: doc.metadata?.index ?? "unknown",
        }));

    } catch (error) {
        console.error('Error retrieving relevant content:', error);
        return [];
    }
}

async function getResult(graph, question, k = TOP_K, documents = [], generation = '', strategy = '', routeReason = '') {
    const result = await graph.invoke(
        {
            question: question,
            k: k,
            strategy: strategy,
            routeReason: routeReason,
            documents: documents,
            generation: generation,
        }
    );
    console.log("\n[Retrieved Relevant Content]");
    if (result.strategy === "complex") {
        console.log("Complex strategy used.");
        const snippets = result.retrievedDocs?.length
            ? result.retrievedDocs
            : result.documents ?? [];
        if (snippets.length === 0 && !result.localContext?.trim()) {
            console.log("No relevant content found.");
            return;
        }
        snippets.forEach((item, i) => {
            console.log(`\n[Snippet ${i + 1}] Similarity: ${Number(item.score).toFixed(4)}`);
            console.log(`Book: ${item.bookId}`);
            console.log(`Chapter: ${item.chapter_num}`);
            console.log(`Index: ${item.index}`);
            console.log(
                `Content: ${item.content.substring(0, 200)}${item.content.length > 200 ? "..." : ""}`,
            );
        });
    } else {
        console.log("Simple strategy used.");
    }
    console.log(`Route reason: ${result.routeReason || routeReason}`);
    console.log(`\n[final result strategy] ${result.strategy}`);

    if (!result.generation.trim()) {
        console.log("\n[AI Response]");
        console.log("The model did not return any content.");
        return;
    }
}

async function openaiWebSearch(query, count = 10, question = query) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error("OPENAI_API_KEY is not set");
    }

    const baseURL = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
    const model = process.env.OPENAI_MODEL || process.env.MODEL_NAME || "gpt-4.1-mini";

    const searchLang = detectQuestionLanguage(question);
    const searchPrompt =
        searchLang === "zh"
            ? `请联网搜索并总结与下列问题最相关的信息，优先返回可核验的来源：\n${query}`
            : `Search the web and summarize the most relevant verifiable information for this question:\n${query}`;

    const response = await fetch(`${baseURL}/responses`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            tools: [{ type: "web_search" }],
            include: ["web_search_call.action.sources"],
            input: searchPrompt,
        }),
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenAI web search failed (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const limit = count ?? 10;
    const seen = new Set();
    const items = [];

    if (data.output_text?.trim()) {
        items.push({
            url: "openai-web-search-summary",
            content: data.output_text.trim(),
        });
    }

    for (const item of data.output ?? []) {
        if (item.type !== "web_search_call" || item.action?.type !== "search") {
            continue;
        }
        for (const source of item.action.sources ?? []) {
            if (source.type !== "url" || !source.url || seen.has(source.url)) {
                continue;
            }
            seen.add(source.url);
            items.push({
                url: source.url,
                content: source.url,
            });
        }
    }

    return items.slice(0, limit).map((item, i) => ({
        score: 1 - i * 0.01,
        content: item.content,
        id: `web_${i}`,
        bookId: "web",
        chapter_num: "web",
        index: i,
        url: item.url,
    }));
}

export { getVectorStore, retrieveRelevantContent, mergeUnique, getResult, openaiWebSearch };