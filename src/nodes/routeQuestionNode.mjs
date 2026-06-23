import { model } from '../services/llm.mjs';
import { z } from 'zod';
import { openaiWebSearch, retrieveRelevantContent } from '../services/retriever.mjs';
import { retrieveNode } from './ragNodes.mjs';
import { answerLanguageInstruction, sameLanguageAsQuestionInstruction } from '../utils/language.mjs';

export function afterRoute(state) {
    return state.strategy === "simple" ? "direct_answer" : "local_retrieve";
}

export function afterPlan(state) {
    return state.plannedNext === "retrieve" ? "retrieve" : "generate";
}

const EvaluateSchema = z.object({
    enough: z.boolean(),
    missing: z.array(z.string()).max(6),
    reason: z.string(),
    // OpenAI structured output requires all fields; use empty string when web search is not needed
    web_query: z.string(),
});

const RouteSchema = z.object({
    strategy: z.enum(["simple", "complex"]),
    reason: z.string(),
});

const DecomposeSchema = z.object({
    subQuestions: z.array(z.string()).min(1).max(8),
    reason: z.string(),
});

const NextStepSchema = z.object({
    nextAction: z.enum(["retrieve", "generate"]),
    reason: z.string(),
});

export const routeQuestionNode = async (state) => {
    console.log("---ROUTE_QUESTION---");
    const router = model.withStructuredOutput(RouteSchema);
    const route = await router.invoke(`
You are a question router. Decide whether the user question needs external retrieval.

Rules:
- simple: greetings, small talk, or general questions unrelated to "Demi-Gods and Semi-Devils".
- complex: any question mentioning characters, martial arts, factions, plot, or endings from the novel must be complex so the system can retrieve from the source database.

${sameLanguageAsQuestionInstruction(state.question)}

User question: ${state.question}
`);
    console.log(`Route strategy: ${route.strategy} (${route.reason})`);
    return {
        strategy: route.strategy,
        routeReason: route.reason,
        retrievedDocs: [],
        localContext: "",
        webContext: "",
        evaluation: "",
        generation: "",
    };
};

export const directAnswerNode = async (state) => {
    console.log("---DIRECT_ANSWER---");
    process.stdout.write(`\n[AI stream response]\n`);
    let generation = '';
    const stream = await model.stream(`
You are a helpful assistant. Answer the question directly and concisely.
${answerLanguageInstruction(state.question)}

Question: ${state.question}
`);

    for await (const chunk of stream) {
        const text = typeof chunk.content === 'string' ? chunk.content : "";
        if (text) {
            generation += text;
            process.stdout.write(text);
        }
    }
    process.stdout.write("\n");
    return {
        question: state.question,
        k: state.k,
        strategy: state.strategy,
        routeReason: state.routeReason,
        documents: [],
        generation,
    };
};

export const decideNext = async (state) => {
    return state.strategy === "simple" ? "direct_answer" : "retrieve";
};

export const decomposeQuestionNode = async (state) => {
    console.log("---DECOMPOSE_QUESTION---");
    const decomposer = model.withStructuredOutput(DecomposeSchema);
    const decomposed = await decomposer.invoke(`
You are a sub-question decomposer for multi-hop Q&A about "Demi-Gods and Semi-Devils".
Each sub-question will be used for sequential vector retrieval. Requirements:
- Each item must be a complete, standalone retrieval query in the same language as the user question
- Use explicit character, event, place, or relation names; avoid pronouns like "he/she/this person/his father"
- Write retrieval-friendly questions, not keyword lists

Decomposition rules:
1. Multi-hop / chained questions: split into 2-4 ordered steps; later steps should embed entities resolved in earlier steps.
2. Single-hop factual questions: rewrite into 2-3 retrieval angles instead of copying the original question verbatim.
3. Prefer novel-specific proper nouns to improve vector search.

Example 1 (multi-hop, Chinese question):
Original: Who is ranked second among the Four Great Evils in Demi-Gods and Semi-Devils? Before the child's parentage is revealed, what is the father's public identity in the martial world?
subQuestions:
- What are the names and ranking order of the Four Great Evils in Demi-Gods and Semi-Devils?
- Who is ranked second among the Four Great Evils (Evil Without Parallel)?
- Who is Ye Erniang's son?
- Before Xuzhu's parentage is revealed, what is Xuanci's public identity in the martial world?

Example 2 (single-hop):
Original: What is A Zhu's ending?
subQuestions:
- What happened to A Zhu at Yanmen Pass?
- Why did A Zhu disguise herself as Duan Zhengchun and how did she die?
- What happened between Xiao Feng and A Zhu in the "cattle and sheep promise" scene?

${sameLanguageAsQuestionInstruction(state.question)}

User question:
${state.question}

Return subQuestions (1-8) and a short reason.
`);
    const subQuestions = decomposed.subQuestions.map((s) => s.trim()).filter(Boolean);
    if (subQuestions.length === 0) {
        throw new Error("decompose_question: subQuestions is empty");
    }

    console.log(`Decomposed into ${subQuestions.length} sub-questions (${decomposed.reason})`);
    subQuestions.forEach((q, i) => {
        console.log(`  [${i + 1}] ${q}`);
    });

    return {
        subQuestions,
        nextSubIdx: 0,
        currentQuery: subQuestions[0],
    };
};

export const planNextStepNode = async (state) => {
    console.log("---PLAN_NEXT_STEP---");
    const subs = state.subQuestions ?? [];
    const nextIdx = state.nextSubIdx ?? 0;
    const remaining = subs.length - nextIdx;

    const subList = subs
        .map((s, i) =>
            `${i + 1}. ${s}${i < nextIdx ? " (retrieved)" : i === nextIdx ? " (next if continuing)" : " (pending)"}`,
        )
        .join("\n");

    const docStr =
        state.documents.length === 0
            ? "No retrieval results yet"
            : state.documents
                  .slice(0, 6)
                  .map(
                      (d, i) =>
                          `[${i + 1}] score=${Number(d.score).toFixed(4)} chapter=${d.chapter_num}: ${d.content.slice(0, 200)}${d.content.length > 200 ? "..." : ""}`,
                  )
                  .join("\n\n");

    const prompt = `
You are a multi-hop RAG planner. Retrieval queries were already decomposed into ordered sub-questions.
If more retrieval is needed, the next round will automatically use the next sub-question. Do not invent a new retrieval query.

Original user question: ${state.question}
Sub-question sequence:
${subList || "(none)"}
Retrieval rounds completed: ${state.retrievalCount}; remaining sub-questions: ${remaining}
Max retrieval rounds: ${state.maxRetrievals}
Retrieved document summary:
${docStr}

Decide the next step:
1) Enough evidence to answer the original question -> nextAction=generate
2) Still missing key facts, unresolved sub-questions remain, and under the round limit -> nextAction=retrieve

Hard rules:
- If no sub-questions remain, nextAction must be generate.
- If retrieval rounds reached the max limit, nextAction must be generate.

${sameLanguageAsQuestionInstruction(state.question)}
`;

    const planner = model.withStructuredOutput(NextStepSchema);
    const { nextAction, reason } = await planner.invoke(prompt);

    let finalNext = nextAction;
    if (state.retrievalCount >= state.maxRetrievals) {
        finalNext = "generate";
    }
    if (remaining <= 0) {
        finalNext = "generate";
    }

    console.log(`[Decision] plannedNext=${finalNext} (model suggested=${nextAction}) (${reason})`);

    return {
        plannedNext: finalNext,
    };
};

export const localRetrieveNode = async (state) => {
    console.log("---LOCAL_RETRIEVE---");
    return retrieveNode({
        ...state,
        currentQuery: state.currentQuery ?? state.subQuestion ?? state.question,
    });
};

export const webRetrieveNode = async (state) => {
    const parsed = (() => {
        try {
            return JSON.parse(state.evaluation || "{}");
        } catch {
            return {};
        }
    })();

    const query = (parsed.web_query ?? "").trim() || state.question;

    console.log(`Web search query: ${query}`);
    const webResults = await openaiWebSearch(query, 8, state.question);
    const webContext = webResults.map((d) => d.content).join("\n\n");
    console.log(`Web context length: ${webContext.length}`);

    return {
        webContext,
    };
};

export const retrieveLocalNode = async (state) => {
    console.log("---LOCAL_RETRIEVE---");
    const retrievedDocs = await retrieveRelevantContent(state.question, state.k);
    console.log(`Local retrieval hits: ${retrievedDocs.length}`);
    const localContext = (retrievedDocs ?? []).map((d) => d.content).join("\n\n");
    return {
        retrievedDocs,
        localContext,
    };
};

export const evaluateNode = async (state) => {
    const hasWeb = Boolean(state.webContext && String(state.webContext).trim());
    console.log(hasWeb ? "---EVALUATE_CONTEXT_WITH_WEB---" : "---EVALUATE_LOCAL_CONTEXT---");
    const evaluator = model.withStructuredOutput(EvaluateSchema);
    const out = await evaluator.invoke(`You are a context sufficiency evaluator. Decide whether the current context is enough to answer the user question.

User question: ${state.question}

Retrieved context (local knowledge base):
${state.localContext || "(empty)"}

${hasWeb ? `Web search results:\n${state.webContext || "(empty)"}\n` : ""}

Output fields:
- enough: whether the context is sufficient (true/false)
- missing: if not enough, list missing information points (max 6)
- reason: short explanation
- web_query: ${
        hasWeb
            ? 'already includes web results; set this field to an empty string ""'
            : 'if not enough, provide one complete web-search query in the same language as the user question; if enough, set to ""'
    }

${sameLanguageAsQuestionInstruction(state.question)}
`);

    console.log(`${hasWeb ? "Re-evaluation" : "Evaluation"}: enough=${out.enough} (${out.reason})`);
    console.log(`Context length: local=${(state.localContext || "").length}, web=${(state.webContext || "").length}`);
    if (!out.enough && out.missing?.length) {
        out.missing.forEach((m, i) => console.log(`  Missing ${i + 1}: ${m}`));
    }
    return {
        evaluation: JSON.stringify(out),
    };
};

export function afterEvaluateLocal(state) {
    if (state.webContext && String(state.webContext).trim()) {
        return "generate";
    }
    const parsed = (() => {
        try {
            return JSON.parse(state.evaluation || "{}");
        } catch {
            return {};
        }
    })();
    return parsed.enough === true ? "generate" : "web_search";
}
