import 'dotenv/config';

import { Annotation, END, START, StateGraph } from '@langchain/langgraph';

import { model } from './services/llm.mjs';
import { getVectorStore, retrieveRelevantContent } from './services/retriever.mjs';


async function main() {
    const question = "阿朱的结局是什么？";
    const k_Args = 5;

    // Ensure the database connection is successful (optional, if you want to check the connection at startup)
    await getVectorStore();
    
    const drawable = await graph.getGraphAsync();
    const mermaid = drawable.drawMermaid({ withStyles: true });
    console.log(mermaid);

}



