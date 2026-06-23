import { Annotation } from "@langchain/langgraph";

export const GraphState = Annotation.Root({
    question: Annotation,
    k: Annotation,
    strategy: Annotation,
    routeReason: Annotation,
    // Decomposed sub-questions, only used for retrieval
    subQuestions: Annotation,
    // Index of the next sub-question to process
    nextSubIdx: Annotation,
    documents: Annotation,
    currentQuery: Annotation,
    retrievalCount: Annotation,
    maxRetrievals: Annotation,
    plannedNext: Annotation,
    generation: Annotation,
});