import { retrieveRelevantContent, mergeUnique } from '../services/retriever.mjs';
import { model } from '../services/llm.mjs';
import { answerLanguageInstruction } from '../utils/language.mjs';

export const retrieveNode = async (state) => {
    const subs = state.subQuestions ?? [];
    const idx = state.nextSubIdx ?? 0;
    const q = subs[idx]?.trim();
    if (!q) {
        throw new Error(`retrieve: no valid sub-question at index ${idx} (total ${subs.length})`);
    }

    const round = (state.retrievalCount ?? 0) + 1;
    console.log(`---RETRIEVE (round ${round}, sub-question ${idx + 1}/${subs.length})---`);
    console.log(`Query: ${q}`);

    const newDocs = await retrieveRelevantContent(q, state.k);
    const merged = mergeUnique(state.documents ?? [], newDocs);

    if (newDocs.length === 0) {
        console.log("No documents matched this round");
    } else {
        console.log(`Matched ${newDocs.length} docs, ${merged.length} unique after merge`);
        newDocs.forEach((item, i) => {
            const preview =
                item.content.length > 120 ? `${item.content.substring(0, 120)}...` : item.content;
            console.log(
                `[R${i + 1}] score=${Number(item.score).toFixed(4)} chapter=${item.chapter_num} index=${item.index}`,
            );
            console.log(`      ${preview}`);
        });
    }

    return {
        documents: merged,
        retrievalCount: round,
        nextSubIdx: idx + 1,
        currentQuery: q,
    };
};

export const generateNode = async (state) => {
    const { question, k, strategy, routeReason, localContext, webContext, evaluation } = state;
    const parsed = (() => {
        try {
            return JSON.parse(evaluation || "{}");
        } catch {
            return {};
        }
    })();
    const contextSufficient = parsed.enough === true;

    const contextParts = [];
    if (localContext?.trim()) {
        contextParts.push(`[Local knowledge base]\n${localContext}`);
    }
    if (webContext?.trim()) {
        contextParts.push(`[Web search results]\n${webContext}`);
    }
    const context = contextParts.join("\n\n---\n\n") || "(No relevant content retrieved)";

    const insufficientNote = contextSufficient
        ? ""
        : `\nImportant: The evaluator determined the reference content is NOT sufficient to answer fully.
        Missing points: ${(parsed.missing ?? []).join("; ") || "unknown"}
        You MUST state clearly that the retrieved sources do not contain enough evidence. Do NOT use outside knowledge or guess.`;

            const prompt = `You are a professional assistant for the novel "Demi-Gods and Semi-Devils" (天龙八部).
        Answer using accurate, detailed language based only on the reference content below.

        Reference content:
        ${context}

        User question: ${question}
        ${insufficientNote}

        Requirements:
        1. ${answerLanguageInstruction(question)}
        2. If the reference content contains relevant information, provide a detailed and accurate answer.
        3. You may synthesize multiple snippets into one complete answer.
        4. If the reference content does not contain relevant information, say so honestly. Do not fabricate facts.
        5. Keep the answer consistent with the novel's plot and characters.
        6. You may quote the source text to support your answer.

        Assistant answer:`;

    process.stdout.write(`\n[AI stream response]\n`);

    let generation = '';
    const stream = await model.stream(prompt);
    for await (const chunk of stream) {
        const text = typeof chunk.content === 'string' ? chunk.content : "";
        if (text) {
            generation += text;
            process.stdout.write(text);
        }
    }
    process.stdout.write("\n");
    return {
        question: question,
        strategy: strategy,
        routeReason: routeReason,
        k: k,
        generation: generation,
        webContext: webContext,
        localContext: localContext,
    };
};
