/** Detect whether the user question is primarily Chinese or English. */
export function detectQuestionLanguage(text = "") {
    const sample = String(text).trim();
    if (!sample) {
        return "en";
    }
    const cjkCount = (sample.match(/[\u4e00-\u9fff]/g) || []).length;
    const latinCount = (sample.match(/[A-Za-z]/g) || []).length;
    return cjkCount >= latinCount ? "zh" : "en";
}

/** Instruction appended to generation prompts so answers match question language. */
export function answerLanguageInstruction(question) {
    return detectQuestionLanguage(question) === "zh"
        ? "Respond in Chinese (Simplified Chinese)."
        : "Respond in English.";
}

/** Instruction for structured fields that should follow the user question language. */
export function sameLanguageAsQuestionInstruction(question) {
    return detectQuestionLanguage(question) === "zh"
        ? "Use Simplified Chinese for text fields unless quoting source material."
        : "Use English for text fields unless quoting source material.";
}
