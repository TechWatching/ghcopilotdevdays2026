// A deliberately small YAML reader/writer for the block-style data files in
// content/ (maps, sequences, flow sequences of scalars, quoted and block
// scalars, comments). Extensions cannot ship dependencies, so this covers the
// subset the site uses and fails loudly on anything else.

export class YamlError extends Error {}

const SEQ_ITEM = /^-(?:[ \t]|$)/;
const BLOCK_HEADER = /^([|>])([1-9])?([+-])?([1-9])?[ \t]*(?:#.*)?$/;

export function parseYaml(source) {
    const normalized = String(source).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    const lines = normalized.split("\n");
    if (normalized.endsWith("\n")) lines.pop();
    let i = 0;

    const indentOf = (line) => line.length - line.replace(/^ +/, "").length;
    const isIgnorable = (line) => /^[ \t]*(?:#.*)?$/.test(line);
    const skip = () => {
        while (i < lines.length && isIgnorable(lines[i])) i++;
    };
    const fail = (message, at = i) => {
        throw new YamlError(`${message} (line ${Math.min(at, lines.length - 1) + 1})`);
    };

    function parseNode(minIndent) {
        skip();
        if (i >= lines.length) return null;
        const indent = indentOf(lines[i]);
        if (indent < minIndent) return null;
        const text = lines[i].slice(indent);
        if (text.startsWith("\t")) fail("Tabs are not allowed for indentation");
        if (SEQ_ITEM.test(text)) return parseSeq(indent);
        if (splitKey(text)) return parseMap(indent);
        i++;
        return parseInline(text, indent - 1);
    }

    function parseSeq(indent) {
        const out = [];
        for (;;) {
            skip();
            if (i >= lines.length) break;
            const line = lines[i];
            const ind = indentOf(line);
            if (ind < indent) break;
            if (ind > indent) fail("Unexpected indentation");
            const text = line.slice(ind);
            if (!SEQ_ITEM.test(text)) break;
            const after = text.slice(1);
            const rest = after.replace(/^[ \t]+/, "");
            const column = ind + 1 + (after.length - rest.length);
            if (rest === "" || rest.startsWith("#")) {
                i++;
                out.push(parseNode(indent + 1));
            } else if (SEQ_ITEM.test(rest) || splitKey(rest)) {
                // Re-read "- key: value" as a map (or nested list) starting at the item's column.
                lines[i] = " ".repeat(column) + rest;
                out.push(parseNode(column));
            } else {
                i++;
                out.push(parseInline(rest, indent));
            }
        }
        return out;
    }

    function parseMap(indent) {
        const out = {};
        for (;;) {
            skip();
            if (i >= lines.length) break;
            const line = lines[i];
            const ind = indentOf(line);
            if (ind < indent) break;
            if (ind > indent) fail("Unexpected indentation");
            const text = line.slice(ind);
            if (SEQ_ITEM.test(text)) break;
            const entry = splitKey(text);
            if (!entry) fail('Expected "key: value"');
            i++;
            const { key, rest } = entry;
            if (Object.prototype.hasOwnProperty.call(out, key)) fail(`Duplicate key "${key}"`, i - 1);
            let value = null;
            if (rest === "" || rest.startsWith("#")) {
                skip();
                if (i < lines.length) {
                    const nextIndent = indentOf(lines[i]);
                    const nextText = lines[i].slice(nextIndent);
                    if (nextIndent > indent) value = parseNode(nextIndent);
                    else if (nextIndent === indent && SEQ_ITEM.test(nextText)) value = parseSeq(indent);
                }
            } else {
                value = parseInline(rest, indent);
            }
            Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
        }
        return out;
    }

    // Parses a value that starts on the current (already consumed) line.
    // Continuation lines must be indented deeper than `ownerIndent`.
    function parseInline(text, ownerIndent) {
        const t = text.trim();
        const header = BLOCK_HEADER.exec(t);
        if (header) return readBlockScalar(header, ownerIndent);
        if (t[0] === '"' || t[0] === "'") return readQuotedValue(t, ownerIndent);
        if (t[0] === "[") return parseFlowSequence(t);
        if (t[0] === "{") return parseFlowMap(t);
        if (/^[&*!%@`]/.test(t)) fail("Anchors, aliases and tags are not supported", i - 1);
        const parts = [stripComment(t)];
        let commented = parts[0] !== t;
        while (i < lines.length && !isIgnorable(lines[i]) && indentOf(lines[i]) > ownerIndent) {
            if (commented) fail("A comment cannot be followed by more of the same value");
            const next = lines[i].trim();
            const part = stripComment(next);
            commented = part !== next;
            parts.push(part);
            i++;
        }
        const value = parts.join(" ");
        if (/:(?:[ \t]|$)/.test(value)) fail('Unquoted values cannot contain ": " (quote the value)', i - 1);
        return resolvePlain(value);
    }

    function readBlockScalar(header, ownerIndent) {
        const style = header[1];
        const explicit = Number(header[2] || header[4] || 0);
        const chomp = header[3] || "";
        const body = [];
        let blockIndent = explicit ? Math.max(ownerIndent, 0) + explicit : null;
        while (i < lines.length) {
            const line = lines[i];
            if (/^ *$/.test(line)) {
                body.push(blockIndent === null ? "" : line.slice(blockIndent));
                i++;
                continue;
            }
            const ind = indentOf(line);
            if (blockIndent === null) {
                if (ind <= ownerIndent) break;
                blockIndent = ind;
            }
            if (ind < blockIndent) break;
            body.push(line.slice(blockIndent));
            i++;
        }
        let trailing = 0;
        while (body.length && body[body.length - 1] === "") {
            body.pop();
            trailing++;
        }
        if (!body.length) return chomp === "+" ? "\n".repeat(trailing) : "";
        const text = style === "|" ? body.join("\n") : foldLines(body);
        if (chomp === "-") return text;
        if (chomp === "+") return text + "\n".repeat(trailing + 1);
        return `${text}\n`;
    }

    function readQuotedValue(t, ownerIndent) {
        let text = t;
        for (;;) {
            const parsed = readQuoted(text, 0);
            if (parsed) {
                const tail = text.slice(parsed.end).trim();
                if (tail && !tail.startsWith("#")) fail("Unexpected text after a quoted value", i - 1);
                return parsed.value;
            }
            let newlines = 0;
            while (i < lines.length && /^[ \t]*$/.test(lines[i])) {
                newlines++;
                i++;
            }
            if (i >= lines.length || indentOf(lines[i]) <= ownerIndent) fail("Unterminated quoted value", i - 1);
            const next = lines[i].trim();
            i++;
            if (t[0] === '"' && !newlines && /(?:^|[^\\])(?:\\\\)*\\$/.test(text)) text = text.slice(0, -1) + next;
            else text += newlines ? "\n".repeat(newlines) + next : ` ${next}`;
        }
    }

    function parseFlowSequence(t) {
        const close = findClosing(t, "[", "]");
        if (close < 0) fail("Multi-line or nested flow sequences are not supported", i - 1);
        const tail = t.slice(close + 1).trim();
        if (tail && !tail.startsWith("#")) fail("Unexpected text after a flow sequence", i - 1);
        return splitFlow(t.slice(1, close)).map((item) => flowScalar(item));
    }

    function parseFlowMap(t) {
        const close = findClosing(t, "{", "}");
        if (close < 0) fail("Multi-line or nested flow maps are not supported", i - 1);
        const tail = t.slice(close + 1).trim();
        if (tail && !tail.startsWith("#")) fail("Unexpected text after a flow map", i - 1);
        const out = {};
        for (const item of splitFlow(t.slice(1, close))) {
            const entry = splitKey(item);
            if (!entry) fail("Unsupported flow map entry", i - 1);
            Object.defineProperty(out, entry.key, {
                value: entry.rest ? flowScalar(entry.rest) : null,
                enumerable: true,
                writable: true,
                configurable: true,
            });
        }
        return out;
    }

    function flowScalar(item) {
        if (item[0] === '"' || item[0] === "'") {
            const parsed = readQuoted(item, 0);
            if (!parsed || parsed.end !== item.length) fail("Invalid quoted item in flow collection", i - 1);
            return parsed.value;
        }
        if (/^[[{]/.test(item)) fail("Nested flow collections are not supported", i - 1);
        if (/:(?:[ \t]|$)/.test(item)) fail('Unquoted values cannot contain ": " (quote the value)', i - 1);
        return resolvePlain(item);
    }

    skip();
    if (i < lines.length && /^---[ \t]*$/.test(lines[i])) i++;
    const root = parseNode(0);
    skip();
    if (i < lines.length) fail("Unexpected content");
    return root;
}

function splitKey(text) {
    if (text[0] === '"' || text[0] === "'") {
        const parsed = readQuoted(text, 0);
        if (!parsed) return null;
        const m = /^[ \t]*:(?:[ \t]+|$)/.exec(text.slice(parsed.end));
        if (!m) return null;
        return { key: parsed.value, rest: text.slice(parsed.end + m[0].length).trim() };
    }
    if (/^[[\]{}&*!|>%@`#,?]/.test(text)) return null;
    const m = /^(.*?)[ \t]*:(?:[ \t]+|$)/.exec(text);
    if (!m || m[1] === "" || /[ \t]#/.test(m[1])) return null;
    return { key: m[1], rest: text.slice(m[0].length).trim() };
}

function readQuoted(text, start) {
    const q = text[start];
    let out = "";
    let k = start + 1;
    while (k < text.length) {
        const ch = text[k];
        if (q === "'") {
            if (ch === "'") {
                if (text[k + 1] === "'") {
                    out += "'";
                    k += 2;
                    continue;
                }
                return { value: out, end: k + 1 };
            }
            out += ch;
            k++;
            continue;
        }
        if (ch === "\\") {
            if (k + 1 >= text.length) return null;
            const escaped = readEscape(text, k);
            out += escaped.value;
            k = escaped.end;
            continue;
        }
        if (ch === '"') return { value: out, end: k + 1 };
        out += ch;
        k++;
    }
    return null;
}

const SIMPLE_ESCAPES = {
    "0": "\0", a: "\x07", b: "\b", t: "\t", "\t": "\t", n: "\n", v: "\v", f: "\f", r: "\r",
    e: "\x1b", " ": " ", '"': '"', "/": "/", "\\": "\\", N: "\x85", _: "\xa0", L: "\u2028", P: "\u2029",
};

function readEscape(text, k) {
    const code = text[k + 1];
    if (Object.prototype.hasOwnProperty.call(SIMPLE_ESCAPES, code)) return { value: SIMPLE_ESCAPES[code], end: k + 2 };
    const width = { x: 2, u: 4, U: 8 }[code];
    if (width) {
        const hex = text.slice(k + 2, k + 2 + width);
        if (hex.length === width && /^[0-9a-fA-F]+$/.test(hex)) {
            return { value: String.fromCodePoint(parseInt(hex, 16)), end: k + 2 + width };
        }
    }
    throw new YamlError(`Unsupported escape sequence "\\${code}"`);
}

function findClosing(text, open, close) {
    let q = null;
    for (let k = 1; k < text.length; k++) {
        const ch = text[k];
        if (q) {
            if (q === '"' && ch === "\\") k++;
            else if (ch === q) {
                if (q === "'" && text[k + 1] === "'") k++;
                else q = null;
            }
            continue;
        }
        if (ch === '"' || ch === "'") q = ch;
        else if (ch === open) return -1;
        else if (ch === close) return k;
    }
    return -1;
}

function splitFlow(inner) {
    const items = [];
    let q = null;
    let current = "";
    for (let k = 0; k < inner.length; k++) {
        const ch = inner[k];
        if (q) {
            current += ch;
            if (q === '"' && ch === "\\") current += inner[++k] ?? "";
            else if (ch === q) {
                if (q === "'" && inner[k + 1] === "'") current += inner[++k];
                else q = null;
            }
            continue;
        }
        if (ch === '"' || ch === "'") {
            q = ch;
            current += ch;
        } else if (ch === ",") {
            items.push(current.trim());
            current = "";
        } else {
            current += ch;
        }
    }
    items.push(current.trim());
    if (items[items.length - 1] === "") items.pop();
    if (items.some((item) => item === "")) throw new YamlError("Empty item in flow collection");
    return items;
}

function stripComment(text) {
    const m = /[ \t]#/.exec(text);
    return (m ? text.slice(0, m.index) : text).trim();
}

function foldLines(body) {
    let out = "";
    body.forEach((line, k) => {
        if (k === 0) out = line;
        else if (line === "") out += "\n";
        else if (body[k - 1] === "") out += line;
        else if (/^[ \t]/.test(line) || /^[ \t]/.test(body[k - 1])) out += `\n${line}`;
        else out += ` ${line}`;
    });
    return out;
}

// YAML 1.2 core schema resolution (dates stay strings, like the `yaml` package).
export function resolvePlain(s) {
    if (s === "" || s === "~" || /^(?:null|Null|NULL)$/.test(s)) return null;
    if (/^(?:true|True|TRUE)$/.test(s)) return true;
    if (/^(?:false|False|FALSE)$/.test(s)) return false;
    if (/^[-+]?[0-9]+$/.test(s)) return Number(s);
    if (/^0o[0-7]+$/.test(s)) return parseInt(s.slice(2), 8);
    if (/^0x[0-9a-fA-F]+$/.test(s)) return parseInt(s.slice(2), 16);
    if (/^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?$/.test(s)) return Number(s);
    if (/^[-+]?\.(?:inf|Inf|INF)$/.test(s)) return s.startsWith("-") ? -Infinity : Infinity;
    if (/^\.(?:nan|NaN|NAN)$/.test(s)) return NaN;
    return s;
}

// ---------------------------------------------------------------------------
// Writing

const AMBIGUOUS_PLAIN = /^(?:~|null|true|false|yes|no|on|off|y|n)$/i;
const NUMBER_LIKE = /^[-+]?(?:[0-9][0-9_]*(?:\.[0-9_]*)?|\.[0-9]+)(?:[eE][-+]?[0-9]+)?$|^0[xob][0-9a-f_]+$|^[-+]?\.(?:inf|nan)$|^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+(?:\.[0-9_]*)?$/i;
const DATE_LIKE = /^\d{4}-\d{1,2}-\d{1,2}(?:$|[Tt ])/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\ufeff]/;

// True when a string can be written without quotes and still read back as the same string.
export function isPlainSafe(value) {
    if (typeof value !== "string" || value === "" || value !== value.trim()) return false;
    if (CONTROL.test(value)) return false;
    if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(value)) return false;
    if (/:(?:\s|$)/.test(value) || /\s#/.test(value)) return false;
    if (AMBIGUOUS_PLAIN.test(value) || NUMBER_LIKE.test(value) || DATE_LIKE.test(value)) return false;
    return true;
}

export function quote(value) {
    return `"${String(value).replace(/[\\"\u0000-\u001f\u007f-\u009f\u2028\u2029\ufeff]/g, (ch) => {
        switch (ch) {
            case "\\": return "\\\\";
            case '"': return '\\"';
            case "\n": return "\\n";
            case "\t": return "\\t";
            case "\r": return "\\r";
            default: return `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`;
        }
    })}"`;
}

export function scalar(value) {
    const s = String(value);
    return isPlainSafe(s) ? s : quote(s);
}

// Emits `key: value` for free text: a literal block for multi-line text,
// otherwise a double-quoted string. Returns an array of lines.
export function textEntry(key, text, indent = "") {
    const value = String(text);
    const blockable = value.includes("\n")
        && !/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029\ufeff]/.test(value)
        && !/^[ \t]/.test(value);
    if (!blockable) return [`${indent}${key}: ${quote(value)}`];
    return [`${indent}${key}: |-`, ...value.split("\n").map((line) => (line ? `${indent}  ${line}` : ""))];
}
