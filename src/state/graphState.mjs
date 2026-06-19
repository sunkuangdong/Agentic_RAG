import { Annotation } from "@langchain/langgraph";
import { retrieveNode } from "../nodes/ragNodes.mjs";

export const GraphState = Annotation.Root({
    question: Annotation,
    k: Annotation,
    strategy: Annotation,
    routeReason: Annotation,
    // Decomposed sub-questions, only used for retrieval
    subQuestion: Annotation,
    // Index of the next sub-question to process
    nextSubIdx: Annotation,
    documents: Annotation,
    currentQuery: Annotation,
    retrieveCount: Annotation,
    maxRetrieves: Annotation,
    plannedNext: Annotation,
    generation: Annotation,
});