import 'dotenv/config';
import { END, START, StateGraph } from '@langchain/langgraph';
import { getVectorStore, getResult } from './services/retriever.mjs';
import { GraphState } from './state/graphState.mjs';
import { retrieveNode, generateNode } from './nodes/ragNodes.mjs';
import { routeQuestionNode, directAnswerNode, decomposeQuestionNode, afterRoute, planNextStepNode, afterPlan } from './nodes/routeQuestionNode.mjs';

const graph = new StateGraph(GraphState)
                .addNode("route_question", routeQuestionNode)
                .addNode('direct_answer', directAnswerNode)
                .addNode('decompose_question', decomposeQuestionNode)
                .addNode('retrieve', retrieveNode)
                .addNode('plan_next_step', planNextStepNode)
                .addNode('generate', generateNode)
                .addEdge(START, 'route_question')
                .addConditionalEdges("route_question", afterRoute, {
                    direct_answer: "direct_answer",
                    decompose_question: "decompose_question",})
                .addEdge('decompose_question', 'retrieve')
                .addEdge('retrieve', 'plan_next_step')
                .addConditionalEdges("plan_next_step", afterPlan, {
                    retrieve: "retrieve",
                    generate: "generate",
                })
                .addEdge('direct_answer', END)
                .addEdge('generate', END)
                .compile();

async function main() {
    const question = "《天龙八部》中「四大恶人」排行第二的是谁？此人之子在身世揭晓前，其生父在武林中的公开身份是什么？";
    const k_Args = 5;

    // Ensure the database connection is successful (optional, if you want to check the connection at startup)
    await getVectorStore(question);
    await getResult(graph, question, k_Args, [], '', '', '');
}

main();



