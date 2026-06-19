import { retrieveRelevantContent } from '../services/retriever.mjs';
import { model } from '../services/llm.mjs';

export const retrieveNode = async (state) => {
    const { question, k } = state;
    const documents = await retrieveRelevantContent(question, k);
    return {
        question,
        k,
        documents,
    };
}

export const generateNode = async (state) => {
    const { documents, question, k } = state;
    console.log("documents: ", documents);
    const context = documents.map(
        (item, index) => `[Snippet ${index + 1}]
            Chapter: ${item.chapter_num}
            Content: ${item.content}`
    ).join("\n\n ------- \n\n");

    const prompt = `You are a professional assistant for the novel "Demi-Gods and Semi-Devils". Answer questions based on the novel's content using accurate and detailed language.

        Please answer the question based on the following excerpts from "Demi-Gods and Semi-Devils":
        ${context}

        User Question: ${question}

        Requirements:
        1. If the excerpts contain relevant information, provide a detailed and accurate answer combining the novel's content.
        2. You can synthesize content from multiple excerpts to provide a complete answer.
        3. If the excerpts do not contain relevant information, inform the user truthfully.
        4. The answer must be accurate and consistent with the novel's plot and character settings.
        5. You may quote the original text to support your answer.

        AI Assistant's Answer:`;
    
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
        documents: documents,
        k: k,
        generation: generation,
    };
}