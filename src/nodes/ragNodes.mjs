import { retrieveRelevantContent, mergeUnique } from '../services/retriever.mjs';
import { model } from '../services/llm.mjs';

export const retrieveNode = async (state) => {
    const subs = state.subQuestions ?? [];
    const idx = state.nextSubIdx ?? 0;
    const q = subs[idx]?.trim();
    if (!q) {
        throw new Error(`retrieve: 子问题下标 ${idx} 无有效文本（共 ${subs.length} 条）`);
    }

    const round = (state.retrievalCount ?? 0) + 1;
    console.log(`---RETRIEVE (第 ${round} 轮，子问题 ${idx + 1}/${subs.length})---`);
    console.log(`查询: ${q}`);

    const newDocs = await retrieveRelevantContent(q, state.k);
    const merged = mergeUnique(state.documents ?? [], newDocs);

    if (newDocs.length === 0) {
        console.log("本轮未命中文档");
    } else {
        console.log(`本轮命中 ${newDocs.length} 条，累计去重后 ${merged.length} 条`);
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
    const { documents, question, k, strategy, routeReason } = state;
    console.log("documents: ", documents);
    const context = documents.map(
        (item, index) => `[Snippet ${index + 1}]
            Chapter: ${item.chapter_num}
            Content: ${item.content}`
    ).join("\n\n ------- \n\n");

    const prompt = `你是一个专业的《天龙八部》小说助手。请根据小说内容，用准确、详细的中文回答问题。

        请根据以下《天龙八部》小说片段内容回答问题：
        ${context}

        用户问题：${question}

        回答要求：
        1. 必须使用中文回答。
        2. 如果片段中有相关信息，请结合小说内容给出详细、准确的回答。
        3. 可以综合多个片段的内容，提供完整的答案。
        4. 如果片段中没有相关信息，请如实告知用户。
        5. 回答要准确，符合小说的情节和人物设定。
        6. 可以引用原文内容来支持你的回答。

        AI 助手的回答：`;
    
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
        documents: documents,
        routeReason: routeReason,
        k: k,
        generation: generation,
    };
}