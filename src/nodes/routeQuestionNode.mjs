import {model} from '../services/llm.mjs';
import { z } from 'zod';

export function afterRoute(state) {
    return state.strategy === "simple" ? "direct_answer" : "decompose_question";
}

export function afterPlan(state) {
    return state.plannedNext === "retrieve" ? "retrieve" : "generate";
}

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
    const router = model.withStructuredOutput(RouteSchema)
    const route = await router.invoke(`
        你是问答路由器。请判断用户问题是否需要外部检索。

        规则：
        - simple: 仅限于日常问候（如“你好”）、闲聊、或者完全与《天龙八部》无关的通用问题。
        - complex: 只要问题中提到了《天龙八部》的人物（如阿朱、段誉、乔峰等）、武功、门派、情节或结局，无论你是否知道答案，都必须分类为 complex，以便去原文数据库中检索准确细节。

        用户问题：${state.question}
    `);
    console.log(`路由策略: ${route.strategy} (${route.reason})`);
    return {
        strategy: route.strategy,
        routeReason: route.reason,
        retrievedDocs: [],
        localContext: "",
        webContext: "",
        evaluation: "",
        generation: "",
    };
}

export const directAnswerNode = async (state) => {
    console.log("---DIRECT_ANSWER---");
    process.stdout.write(`\n[AI stream response]\n`);
    let generation = '';
    const stream = await model.stream(`
        你是一个中文问答助手，请直接简洁回答问题。
        问题：${state.question}
    `)

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
}

export const decideNext = async (state) => {
    return state.strategy === "simple" ? "direct_answer" : "retrieve";
}

export const decomposeQuestionNode = async (state) => {
    console.log("---DECOMPOSE_QUESTION---");
    const decomposer = model.withStructuredOutput(DecomposeSchema);
    const decomposed = await decomposer.invoke(`
        你是《天龙八部》多跳问答的「子问题拆解器」。
        你的输出将用于**依次**去向量数据库检索，因此每条子问题必须：
        - 是完整、可独立检索的中文问句
        - 包含明确人物名/事件名/地点/关系，禁止「他/她/此人/此人之子/其生父」等指代
        - 适合语义检索，不要输出关键词列表

        【拆解原则】
        1. **多跳/链式问题**（含「此人」「其…」「然后」「之前/之后」）：按推理顺序拆成 2～4 条，后一条要把前一条的答案实体写进问句。
        2. **单跳事实问题**（只问一个人/一件事）：不要原样复制用户原题；改写成 2～3 条**不同检索角度**的问句（人物+事件+结果/地点/关系）。
        3. 每条子问题必须比原题更适合向量检索，尽量包含《天龙八部》专有名词。

        【示例 1：多跳】
        原题：《天龙八部》中「四大恶人」排行第二的是谁？此人之子在身世揭晓前，其生父在武林中的公开身份是什么？
        subQuestions:
        - 天龙八部「四大恶人」的名号与排行顺序是什么？
        - 四大恶人中排行第二（无恶不作）的是谁？
        - 叶二娘的儿子是谁？
        - 虚竹身世揭晓前，玄慈在武林中的公开身份是什么？

        【示例 2：单跳】
        原题：阿朱的结局是什么？
        subQuestions:
        - 阿朱在雁门关外发生了什么事？
        - 阿朱为何易容成段正淳，最终如何死亡？
        - 萧峰与阿朱在塞外牛羊空许约情节中发生了什么？

        【示例 3：对比/关系】
        原题：乔峰和慕容复谁的武功更高？
        subQuestions:
        - 乔峰在《天龙八部》中的主要武功和实战表现有哪些？
        - 慕容复在《天龙八部》中的主要武功和实战表现有哪些？

        用户原始问题：
        ${state.question}

        请输出 subQuestions（1～8 条）与简短 reason。
    `);
    const subQuestions = decomposed.subQuestions.map((s) => s.trim()).filter(Boolean);
    if (subQuestions.length === 0) {
        throw new Error("decompose_question: sub_questions 为空");
    }

    console.log(`拆解 ${subQuestions.length} 条子问题 (${decomposed.reason})`);
    subQuestions.forEach((q, i) => {
        console.log(`  [${i + 1}] ${q}`);
    });

    return {
        subQuestions,
        nextSubIdx: 0,
        currentQuery: subQuestions[0],
    };
}

export const planNextStepNode = async (state) => {
    console.log("---PLAN_NEXT_STEP---");
    const subs = state.subQuestions ?? [];
    const nextIdx = state.nextSubIdx ?? 0;
    const remaining = subs.length - nextIdx;

    const subList = subs.map((s, i) => `${i + 1}. ${s}${i < nextIdx ? '已检索' : i === nextIdx ? '下一轮即将检索，若选择继续' : '未检索'}`).join("\n");

    const docStr = state.documents.length === 0 ? '暂无检索结果' : state.documents.slice(0, 6).map((d, i) => `[${i+1}] score=${Number(d.score).toFixed(4)} 第${d.chapter_num}章: ${d.content.slice(0, 200)}${d.content.length > 200 ? "..." : ""}`).join("\n\n");
    const prompt = `
    你是多跳 RAG 规划器。检索查询已由前置步骤拆解为**有序子问题**；若需继续检索，下一轮将自动使用「下一条子问题」做向量检索，你**不要**自拟新的检索句。
    用户原始问题：${state.question}
    子问题序列：
    ${subList || "（无）"}
    已检索轮数：${state.retrievalCount}；剩余未检索子问题条数：${remaining}
    最大检索轮数上限：${state.maxRetrievals}
    已召回文档摘要：
    ${docStr}
    请判断下一步：
    1) 已有足够依据回答用户原始问题 → nextAction=generate
    2) 仍缺关键事实、且仍存在未检索的子问题、且未超过轮数上限 → nextAction=retrieve
    硬性规则：
    - 若剩余未检索子问题条数为 0, 必须 nextAction=generate。
    - 若已检索轮数已达到或超过最大检索轮数，必须 nextAction=generate。
`;
    
    const planner = model.withStructuredOutput(NextStepSchema);
    const { nextAction, reason } = await planner.invoke(prompt);

    let finalNext = nextAction;
    if ((state.retrievalCount >= state.maxRetrievals)) {
        finalNext = "generate";
    }
    if (remaining <= 0) {
        finalNext = "generate";
    }

    console.log(`[决策] plannedNext=${finalNext} (模型建议=${nextAction}) (${reason})`);

    return {
        plannedNext: finalNext,
    };
}

export const localRetrieveNode = async (state) => {
    console.log("---LOCAL_RETRIEVE---");
    const query = state.currentQuery ?? state.subQuestion;
    const docs = await retrieveNode(query, state.k);
    return {
        documents: docs,
    };
}
