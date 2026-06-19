import 'dotenv/config';
import { END, START, StateGraph } from '@langchain/langgraph';
import { getVectorStore, getResult } from './services/retriever.mjs';
import { GraphState } from './state/graphState.mjs';
import { retrieveNode, generateNode } from './nodes/ragNodes.mjs';
import { routeQuestionNode, directAnswerNode, decideNext } from './nodes/routeQuestionNode.mjs';

const graph = new StateGraph(GraphState)
                .addNode("route_question", routeQuestionNode)
                .addNode('direct_answer', directAnswerNode)
                .addNode('retrieve', retrieveNode)
                .addNode('generate', generateNode)
                .addEdge(START, 'route_question')
                .addConditionalEdges("route_question", decideNext, {
                    direct_answer: "direct_answer",
                    retrieve: "retrieve",})
                .addEdge('retrieve', 'generate')
                .addEdge('direct_answer', END)
                .addEdge('generate', END)
                .compile();

async function main() {
    const question = "阿朱的结局是什么？";
    const k_Args = 5;

    // Ensure the database connection is successful (optional, if you want to check the connection at startup)
    await getVectorStore(question);
    await getResult(graph, question, k_Args, [], '', '', '');
}

main();



