import 'dotenv/config';
import { END, START, StateGraph } from '@langchain/langgraph';
import { getVectorStore, getResult } from './services/retriever.mjs';
import { GraphState } from './state/graphState.mjs';
import { generateNode } from './nodes/ragNodes.mjs';
import { routeQuestionNode, directAnswerNode, retrieveLocalNode, evaluateNode, webRetrieveNode, afterRoute, afterEvaluateLocal } from './nodes/routeQuestionNode.mjs';

const graph = new StateGraph(GraphState)
                .addNode("route_question", routeQuestionNode)
                .addNode('direct_answer', directAnswerNode)
                .addNode("local_retrieve", retrieveLocalNode)
                .addNode('evaluate_local', evaluateNode)
                .addNode('web_search', webRetrieveNode)
                .addNode('generate', generateNode)
                .addEdge(START, 'route_question')
                .addConditionalEdges("route_question", afterRoute, {
                    direct_answer: "direct_answer",
                    local_retrieve: "local_retrieve",})
                .addEdge('local_retrieve', 'evaluate_local')
                .addConditionalEdges("evaluate_local", afterEvaluateLocal, {
                    web_search: "web_search",
                    generate: "generate",
                })
                .addEdge('web_search', 'evaluate_local')
                .addEdge('direct_answer', END)
                .addEdge('generate', END)
                .compile();

async function main() {
    const question = "《天龙八部》中「四大恶人」排行第二的是谁？此人之子在身世揭晓前，其生父在武林中的公开身份是什么？";
    const k_Args = 8;

    // Ensure the database connection is successful (optional, if you want to check the connection at startup)
    await getVectorStore(question);
    await getResult(graph, question, k_Args, [], '', '', '');
}

main();



