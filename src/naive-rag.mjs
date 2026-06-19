import 'dotenv/config';
import { END, START, StateGraph } from '@langchain/langgraph';
import { getVectorStore, getResult } from './services/retriever.mjs';
import { GraphState } from './state/graphState.mjs';
import { retrieveNode, generateNode } from './nodes/ragNodes.mjs';

const graph = new StateGraph(GraphState)
                .addNode('retrieve', retrieveNode)
                .addNode('generate', generateNode)
                .addEdge(START, 'retrieve')
                .addEdge('retrieve', 'generate')
                .addEdge('generate', END)
                .compile();

async function main() {
    const question = "阿朱的结局是什么？";
    const k_Args = 5;

    // Ensure the database connection is successful (optional, if you want to check the connection at startup)
    await getVectorStore(question);
    await getResult(graph, question, k_Args);
}

main();



