import { Milvus } from '@langchain/community/vectorstores/milvus';
import { embeddings } from './llm.mjs';
import { COLLECTION_NAME, TOP_K } from '../config/rag.mjs';

// Cache the database instance to implement the Singleton pattern
let vectorStore = null;

/**
 * Get or initialize the Milvus vector database instance
 * @returns {Promise<Milvus>} 
 */
async function getVectorStore() {
    if (vectorStore) {
        return vectorStore;
    }

    console.log('Connecting to Milvus database...');

    try {
        vectorStore = await Milvus.fromExistingCollection(
            embeddings, 
            {
                collection_name: COLLECTION_NAME,
                host: process.env.MILVUS_HOST,
                port: process.env.MILVUS_PORT,
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
        console.log('Successfully connected to Milvus database!');
        vectorStore.indexSearchParams = {
            metric_type: "COSINE",
            params: JSON.stringify({ ef: 64 }),
        }
        return vectorStore;
    } catch (error) {
        console.error('Failed to connect to Milvus database:', error);
        throw error;
    }

    
}

async function retrieveRelevantContent(question, k = TOP_K) {
    try {
        // Ensure the database instance is retrieved before searching
        const store = await getVectorStore();
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

export { getVectorStore, retrieveRelevantContent };