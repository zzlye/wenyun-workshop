import stripAnsi from "strip-ansi";

/** 日志和网页输出前隐藏令牌、密钥及显式凭证赋值。 */
export function redactAgentLog(text: string): string {
    return text
        .replace(/(authorization\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\r\n,;]+)/gi, "$1[REDACTED]")
        .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, "$1[REDACTED]")
        .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
        .replace(/((?:api[ _-]*key|token)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1[REDACTED]");
}

/** 按行缓冲错误输出，避免分批到达的凭证绕过脱敏。 */
export function createAgentLogWriter(emit: (text: string) => void, normalize = (text: string) => text) {
    let buffer = "";
    const send = (text: string) => emit(redactAgentLog(normalize(stripAnsi(text))));
    return {
        write(text: string) {
            buffer += text;
            let newline = buffer.indexOf("\n");
            while (newline >= 0) {
                send(buffer.slice(0, newline + 1));
                buffer = buffer.slice(newline + 1);
                newline = buffer.indexOf("\n");
            }
        },
        flush() {
            if (buffer) send(buffer);
            buffer = "";
        },
        clear() {
            buffer = "";
        },
    };
}
