import {model} from '../services/llm.mjs';
import { z } from 'zod';

const RouteSchema = z.object({
    strategy: z.enum(["simple", "complex"]),
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


