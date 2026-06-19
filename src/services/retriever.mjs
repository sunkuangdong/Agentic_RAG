import { Milvus } from '@langchain/community/vectorstores/milvus';
import { embeddings } from './llm.mjs';
import { COLLECTION_NAME, TOP_K } from '../config/rag.mjs';

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

async function retrieveRelevantContent(question, k = TOP_K) {
    try {
        // Ensure the database instance is retrieved before searching
        const store = await getVectorStore(question);
        const docsWithScores = await store.similaritySearchWithScore(question, k);
        
        return docsWithScores.map(([doc, score]) => ({
            score,
            content: doc.pageContent,
            metadata: doc.metadata ?? "unknown",
            id: doc.id ?? "unknown",
            bookId: doc.metadata.book_id ?? "unknown",
            chapter_num: doc.metadata.chapter_num ?? "unknown",
            index: doc.metadata.index ?? "unknown",
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
    if (strategy === "complex") {
        console.log("Complex strategy used.");
        if (result.documents.length === 0) {
            console.log("No relevant content found.");
            console.log("\n[AI Response]");
            console.log("Sorry, I couldn't find any relevant content about Demi-Gods and Semi-Devils.");
            return;
        } else {
            result.documents.forEach((item, i) => {
                console.log(`\n[Snippet ${i + 1}] Similarity: ${item.score.toFixed(4)}`);
                console.log(`Book: ${item.bookId}`);
                console.log(`Chapter: ${item.chapter_num}`);
                console.log(`Index: ${item.index}`);
                console.log(
                    `Content: ${item.content.substring(0, 200)}${item.content.length > 200 ? "..." : ""}`,
                );
            });
        }
    } else {
        console.log("Simple strategy used.");
    }
    console.log(`Route Reason: ${routeReason}`);
    console.log(`\n [final result strategy] ${result.strategy}`);

    if (!result.generation.trim()) {
        console.log("\n[AI Response]");
        console.log("The model did not return any content.");
        return;
    }
}

export { getVectorStore, retrieveRelevantContent, getResult };