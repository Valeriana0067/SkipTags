#!/usr/bin/env node
/**
 * fill-tag-translations.mjs
 *
 * 给 TagList.js（英文标签 → 中文译文）回填中文译文。中文一侧取自三个标签指导页面：
 *   1. scp-wiki-cn/tag-guide          只取正文的「主要标签」「英语站相关标签」两节
 *   2. scp-wiki-cn/tale-tagging-guide 全部
 *   3. scp-wiki-cn/art-tagging-guide  全部
 * 页面上每条标签的写法是「中文标签（english-tag）」，工具据此建立 英文 → 中文 的对应。
 *
 * 建议的更新顺序（两步）：
 *   1) 先同步标签结构：node scrape-tag-list.mjs --merge TagList.js --out TagList.js
 *   2) 再回填译文：    node fill-tag-translations.mjs --file TagList.js --out TagList.js
 * 反过来先填译文也不会丢数据，只是当次报告里「有英文对应、但英文不在英文标签列表里」会偏多。
 *
 * 用法：
 *   node fill-tag-translations.mjs --file TagList.js --out TagList.new.js
 *   node fill-tag-translations.mjs --file TagList.js --out TagList.js      就地更新
 *   node fill-tag-translations.mjs --file TagList.js --dir .\cache         指定快照目录
 *   node fill-tag-translations.mjs --file TagList.js --offline --dir .\cache
 *
 * 参数：
 *   --file <path>       要更新的字典文件，默认 TagList.js
 *   --out <path>        输出路径，缺省写 stdout
 *   --dir <path>        三个中文页面的快照目录，默认系统临时目录下 skiptags-cn-guides
 *   --offline           只用快照，不联网
 *   --ref <path>        另一份既有的标签对照表（可重复），只从中取「英文标签 → 中文译文」：
 *                       默认只补空——文件里或指导页已经给出译文的条目不覆盖；
 *                       且绝不因为参照表新增、删除或移动任何英文标签
 *   --ref-first         参照表的译文优先于指导页（仍然只作用于本字典里已有的英文标签）
 *   --prefer-existing   同一英文标签有多种中文译法时，保留文件里现有的译法（默认采用指导里的）
 *   --comment-all-unmatched  未被指导覆盖的条目一律注释（默认只注释没有译文的那些）
 *   --quiet             不打印统计
 *
 * 回填规则（按优先级）：
 *   ① 精确匹配：指南里出现同名英文标签 → 采用指南的中文译名；
 *   ② 旧名搭桥：指南里的英文名不在本字典里（旧名/废名），但它的中文名与本条目现有译名相同
 *      → 视为同一条，沿用该译名并单列报告；
 *   ③ 同名直配：指南里的中文标签名本身就是一个英文标签（如 scp、meta、_cc、delta-t）→ 直配；
 *   ④ 下划线变体：只差前导下划线（_adult ← adult、_ru ← ru）；属于推断，只在条目还没有译文时才填；
 *   ⑤ 未匹配：有译文的保留原状（默认），没译文的写成注释行，并计入「未敲定翻译」数量。
 * 「工作人员专用」区块里的条目：照常匹配译文，但一律写成注释行，且不计入「未敲定翻译」。
 * 标注「已经不为英文维基使用」的区块：整段忽略——被点名的中文标签名在任何页面里都不再采用，
 * 既不参与统计，也不会写进字典（例如故事指导里还写着旧名 历史性，而现名是 历史）。
 * 参照表（--ref）是「只增不改」的补充来源：只往结果里补译文，英文标签一律以本字典为准，
 * 参照表里多出来的英文标签只会被计数，不会进入结果。补入译文的条目一律启用（去掉行首的 //）；
 * 不想启用的条目就别放进参照表；只有"译文不同"（--ref-first）的条目不改变启用状态。
 * 指南中同一英文标签出现多种中文译名时，优先取文件现有译名，否则取非特殊区块里的第一个，全部列出待你确认。
 * 条目结构、分类注释、条目顺序、原有译文与注释状态都不动，只重写条目行本身。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const USER_AGENT = 'SkipTags-tag-translator/1.0 (local TagList.js maintenance)';
const DEFAULT_FILE = 'TagList.js';
const DEFAULT_CACHE = path.join(os.tmpdir(), 'skiptags-cn-guides');

/** 三个中文标签指导页面；from/to 为 null 表示整篇都要 */
const SOURCES = [
    {
        key: 'cn-tag-guide',
        label: '主页面·标签指导',
        file: 'cn-tag-guide.html',
        url: 'https://scp-wiki-cn.wikidot.com/tag-guide',
        sections: [
            { from: '主要标签', to: '英语站相关标签' },
            { from: '英语站相关标签', to: '中文站相关标签' },
        ],
    },
    {
        key: 'cn-tale-guide',
        label: '故事标签指导',
        file: 'cn-tale-guide.html',
        url: 'https://scp-wiki-cn.wikidot.com/tale-tagging-guide',
        sections: [{ from: null, to: null }],
    },
    {
        key: 'cn-art-guide',
        label: '艺作标签指导',
        file: 'cn-art-guide.html',
        url: 'https://scp-wiki-cn.wikidot.com/art-tagging-guide',
        sections: [{ from: null, to: null }],
    },
];

/** 写明「已经不为英文维基使用」的区块：整段忽略，既不参与统计，也不写进文件 */
const IGNORE_NOTES = [/不为英文维基使用/, /已经不为/, /已停用/];

/** 特殊区块：照常匹配译文，但一律写成注释行，且不计入「未敲定翻译」 */
const SPECIAL_HEADINGS = [/工作人员专用/];
const SPECIAL_NOTES = [/无需翻译/, /不需要翻译/];

// ---------------------------------------------------------------- HTML 工具

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', ndash: '\u2013', mdash: '\u2014', hellip: '\u2026', middot: '\u00b7' };

function decodeEntities(text) {
    return text.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body) => {
        if (body[0] === '#') {
            const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
            return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
        }
        const key = body.toLowerCase();
        return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key] : whole;
    });
}

const stripTags = (html) => decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

function bodyOf(html) {
    const from = html.indexOf('id="page-content"');
    let to = html.indexOf('<div class="page-tags"', from);
    if (to === -1) to = html.indexOf('<div id="page-info"', from);
    return html.slice(from === -1 ? 0 : from, to === -1 ? html.length : to);
}

/** 取某个 h1 标题之后、另一个 h1 标题之前的一段 */
function sliceByHeading(body, fromText, toText) {
    if (!fromText) return { html: body, offset: 0 };
    const re = /<h1[^>]*>\s*(?:<span[^>]*>)?([\s\S]*?)(?:<\/span>)?\s*<\/h1>/gi;
    const heads = [];
    let m;
    while ((m = re.exec(body)) !== null) heads.push({ at: m.index, end: m.index + m[0].length, text: stripTags(m[1]) });
    const start = heads.find((h) => h.text === fromText);
    if (!start) throw new Error('页面里找不到标题「' + fromText + '」');
    const end = toText ? heads.find((h) => h.text === toText) : null;
    return { html: body.slice(start.end, end ? end.at : body.length), offset: start.end };
}

const CN_HREF = '(?![^"]*(?:scpwiki\\.com|scp-wiki\\.wikidot\\.com))[^"]*\\/system:page-tags\\/tag\\/[^"]*';
const CN_ANCHOR = new RegExp(`<a\\b[^>]*href="(${CN_HREF})"[^>]*>([\\s\\S]*?)<\\/a>`, 'gi');
const NEXT_CN = new RegExp(`<a\\b[^>]*href="${CN_HREF}"`, 'i');
const EN_ANCHOR = /<a\b[^>]*href="(https?:\/\/(?:www\.)?(?:scpwiki\.com|scp-wiki\.wikidot\.com)\/system:page-tags\/tag\/[^"]*)"[^>]*>/i;
const PLAIN_EN = /[（(]\s*([a-z0-9_][a-z0-9_&.\-]*)\s*[）)]/;

const tagNameOf = (href) => decodeEntities(decodeURIComponent(href.split('page-tags/tag/')[1].replace(/#.*$/, '').split('?')[0])).trim();

/**
 * 找出正文里的特殊区块范围。
 * 标题命中 SPECIAL_HEADINGS（工作人员专用）→ kind='comment'：照常匹配，但写成注释行；
 * 提示语命中 IGNORE_NOTES（已经不为英文维基使用）→ kind='ignore'：整段忽略。
 * 注意：这类提示语常与它辖下的标签写在同一个 <p> 里，所以范围要从提示语本身开始算，
 * 否则会把整段标签都漏在范围之外。
 */
function specialRanges(html) {
    const marks = [];
    let m;
    const hRe = /<h([1-6])[^>]*>\s*(?:<span[^>]*>)?([\s\S]*?)(?:<\/span>)?\s*<\/h\1>/gi;
    while ((m = hRe.exec(html)) !== null) marks.push({ kind: 'heading', level: Number(m[1]), at: m.index, end: m.index + m[0].length, text: stripTags(m[2]) });
    const pRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
    while ((m = pRe.exec(html)) !== null) marks.push({ kind: 'note', level: 0, at: m.index, end: m.index + m[0].length, text: stripTags(m[1]) });
    marks.sort((a, b) => a.at - b.at);

    const ranges = [];
    marks.forEach((mark, index) => {
        let kind = null;
        if (mark.kind === 'heading' && SPECIAL_HEADINGS.some((re) => re.test(mark.text))) kind = 'comment';
        if (mark.kind === 'note') {
            if (IGNORE_NOTES.some((re) => re.test(mark.text))) kind = 'ignore';
            else if (SPECIAL_NOTES.some((re) => re.test(mark.text))) kind = 'comment';
        }
        if (!kind) return;
        // 标题辖域：到下一个同级或更高级标题为止；提示语辖域：到下一个任意标题为止
        const stopLevel = mark.kind === 'heading' ? mark.level : 6;
        const next = marks.slice(index + 1).find((x) => x.kind === 'heading' && x.level <= stopLevel);
        ranges.push({ from: mark.at, to: next ? next.at : Number.POSITIVE_INFINITY, kind });
    });
    return ranges;
}

/** 以中文标签链接为锚点，抽出「中文标签（english-tag）」条目 */
function collectEntries(html, offset, source) {
    const ranges = specialRanges(html).map((r) => ({
        from: r.from + offset,
        to: r.to === Number.POSITIVE_INFINITY ? r.to : r.to + offset,
        kind: r.kind,
    }));
    let m;

    const out = [];
    CN_ANCHOR.lastIndex = 0;
    while ((m = CN_ANCHOR.exec(html)) !== null) {
        const at = offset + m.index;
        const after = html.slice(m.index + m[0].length);
        const nextCn = after.search(NEXT_CN);
        const windowText = after.slice(0, nextCn === -1 ? 260 : Math.min(nextCn, 260));
        const link = windowText.match(EN_ANCHOR);
        const plain = windowText.match(PLAIN_EN);
        const range = ranges.filter((r) => at >= r.from && at < r.to).sort((a, b) => b.from - a.from)[0];
        out.push({
            source,
            cn: stripTags(m[2]),
            cnTag: tagNameOf(m[1]),
            en: link ? tagNameOf(link[1]) : (plain ? decodeEntities(plain[1]).trim() : null),
            special: range?.kind === 'comment',
            ignored: range?.kind === 'ignore',
        });
    }
    return out;
}

// ---------------------------------------------------------------- 参数与读写

function parseArgs(argv) {
    const opts = {
        file: DEFAULT_FILE, out: null, dir: DEFAULT_CACHE, offline: false, refs: [], refFirst: false,
        preferExisting: false, commentAllUnmatched: false, quiet: false, help: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        const value = () => {
            const v = argv[++i];
            if (v === undefined) throw new Error(flag + ' 缺少参数');
            return v;
        };
        switch (flag) {
            case '--file': opts.file = value(); break;
            case '--out': case '-o': opts.out = value(); break;
            case '--dir': opts.dir = value(); break;
            case '--offline': opts.offline = true; break;
            case '--ref': opts.refs.push(value()); break;
            case '--ref-first': opts.refFirst = true; break;
            case '--prefer-existing': opts.preferExisting = true; break;
            case '--comment-all-unmatched': opts.commentAllUnmatched = true; break;
            case '--quiet': case '-q': opts.quiet = true; break;
            case '--help': case '-h': opts.help = true; break;
            default: throw new Error('未知参数：' + flag);
        }
    }
    return opts;
}

function printHelp() {
    const src = fs.readFileSync(new URL(import.meta.url), 'utf8');
    process.stdout.write(src.slice(src.indexOf('/**'), src.indexOf('*/') + 2) + '\n');
}

async function loadSource(src, opts) {
    const cached = path.join(opts.dir, src.file);
    if (fs.existsSync(cached)) return { html: fs.readFileSync(cached, 'utf8'), from: cached };
    if (opts.offline) throw new Error('离线模式下缺少快照：' + cached);
    const res = await fetch(src.url, { headers: { 'user-agent': USER_AGENT, accept: 'text/html' } });
    if (!res.ok) throw new Error('抓取失败：' + src.url + ' HTTP ' + res.status);
    const html = await res.text();
    fs.mkdirSync(opts.dir, { recursive: true });
    fs.writeFileSync(cached, html, 'utf8');
    return { html, from: src.url };
}

/** 保留行尾拆分，非条目行原样写回 */
const splitLines = (text) => text.split(/(?<=\n)/);
const ENTRY_RE = /^(\s*)(\/\/)?\s*"([^"]+)"\s*:\s*"(.*)"\s*,?\s*$/;
const eolOf = (line) => (line.endsWith('\r\n') ? '\r\n' : (line.endsWith('\n') ? '\n' : ''));

/**
 * 读一份既有的标签对照表，只取「英文标签 → 中文译文」。
 * 注释行也照读（手工补的译文常常就写在注释行里），空译文忽略；同名条目以先出现者为准。
 */
function loadReference(file) {
    if (!fs.existsSync(file)) throw new Error('参照表不存在：' + file);
    const values = new Map();
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const m = ENTRY_RE.exec(line);
        if (!m || !m[4]) continue;
        if (!values.has(m[3])) values.set(m[3], m[4]);
    }
    return values;
}

/** 汇总多份参照表（先给出的优先），并记录本字典里没有的英文标签 */
function collectReferences(files, dictNames) {
    const values = new Map();
    const extraTags = new Set();
    for (const file of files) {
        for (const [name, value] of loadReference(file)) {
            if (!values.has(name)) values.set(name, value);
            if (!dictNames.has(name)) extraTags.add(name);
        }
    }
    return { values, extraTags };
}

/**
 * 用参照表补译文：只补空，绝不新增 / 删除 / 移动英文标签。
 * 补入译文的条目一律启用（去掉行首注释符）——参照表里写了译文，就说明这条可以用；
 * 不想启用的条目，直接不要放进参照表（那它就会保持原样）。
 * --ref-first 时，参照表的译文优先于指导页（但不覆盖 --prefer-existing 要求保留的现有译文）。
 */
function applyReferences(result, stat, ref, opts) {
    const filled = [];
    const overrode = [];
    for (const record of result) {
        const value = ref.values.get(record.dict.name);
        if (!value) continue;
        if (!record.value) {
            record.value = value;
            record.commented = false;                          // 补入译文后启用这一行
            record.status = 'ref-filled';
            filled.push({ name: record.dict.name, cn: value });
        } else if (opts.refFirst && value !== record.value && record.status !== 'prefer-existing') {
            overrode.push({ name: record.dict.name, from: record.value, to: value, status: record.status });
            record.value = value;
        }
    }
    // 补过译文的条目不再算「未敲定翻译」（能补的必然原本没有译文）
    if (filled.length > 0) {
        const names = new Set(filled.map((f) => f.name));
        stat.unmatchedBlank = stat.unmatchedBlank.filter((name) => !names.has(name));
    }
    return { filled, overrode, extraTags: ref.extraTags };
}

// ---------------------------------------------------------------- 匹配

function buildIndex(entries) {
    const byEn = new Map();
    const byKey = new Map();
    const normalize = (name) => name.replace(/^_+/, '').toLowerCase();
    for (const entry of entries) {
        if (entry.en) {
            if (!byEn.has(entry.en)) byEn.set(entry.en, []);
            byEn.get(entry.en).push(entry);
        }
        // 归一化索引：中文标签名本身可能就是英文标签名（scp、_cc），或只差前导下划线（_ru ↔ ru）
        for (const name of [entry.en, entry.cnTag]) {
            if (!name) continue;
            const key = normalize(name);
            if (!byKey.has(key)) byKey.set(key, []);
            if (!byKey.get(key).includes(entry)) byKey.get(key).push(entry);
        }
    }
    return { byEn, byKey, normalize };
}

/**
 * 同一个中文标签在不同页面里挂了不同英文名时（多半是子页面还写着旧英文名），
 * 只保留优先级更高页面（SOURCES 的顺序：主页面 > 故事指导 > 艺作指导）的配对，其余丢弃并报告。
 * 例：故事指导把「神话小说」挂在 mythological 上，而主页面写的是 mythological-fiction。
 */
function resolveCrossSource(entries) {
    const rank = new Map(SOURCES.map((s, i) => [s.key, i]));
    const label = new Map(SOURCES.map((s) => [s.key, s.label]));
    const at = (e) => rank.get(e.source) ?? SOURCES.length;

    const best = new Map();
    for (const entry of entries) {
        if (!best.has(entry.cnTag) || at(entry) < best.get(entry.cnTag)) best.set(entry.cnTag, at(entry));
    }

    const kept = [];
    const conflicts = new Map();
    for (const entry of entries) {
        if (at(entry) === best.get(entry.cnTag)) {
            kept.push(entry);
            continue;
        }
        // 仅在英文名确实不同的时候才算冲突（子页面重复同一配对、或只是描述里的中文标签链接，直接丢掉）
        if (entry.en && !kept.some((k) => k.cnTag === entry.cnTag && k.en === entry.en)) {
            if (!conflicts.has(entry.cnTag)) conflicts.set(entry.cnTag, { cnTag: entry.cnTag, kept: [], dropped: [] });
            conflicts.get(entry.cnTag).dropped.push({ source: label.get(entry.source) || entry.source, en: entry.en });
        }
    }
    for (const [cnTag, item] of conflicts) {
        item.kept = [...new Set(kept.filter((k) => k.cnTag === cnTag && k.en).map((k) => k.en))];
    }
    return { entries: kept, conflicts: [...conflicts.values()] };
}

/**
 * 归一化匹配的候选：若指南条目的英文名本身就在本字典里（且不是当前条目），说明该英文标签另有归属，
 * 不能让当前条目把它抢走（例如 just-girly-things 不能认领 _just-girly-things 的译文）。
 */
function pickByKey(pool, name, dictNames) {
    const eligible = pool.filter((e) => !e.en || e.en === name || !dictNames.has(e.en));
    if (eligible.length === 0) return null;
    return eligible.find((e) => e.en === name)
        || eligible.find((e) => e.cnTag === name)
        || eligible[0];
}

/** 同一英文标签有多种中文译法时的取舍：优先文件现有译名，否则取非特殊区块的第一个 */
function pickGuide(list, oldValue) {
    const normal = list.filter((e) => !e.special);
    const pool = normal.length > 0 ? normal : list;
    const same = oldValue ? pool.find((e) => e.cn === oldValue) : null;
    return same || pool[0];
}

function matchEntries(dictEntries, guides, opts) {
    const { byEn, byKey, normalize } = buildIndex(guides.entries);
    const dictNames = new Set(dictEntries.map((d) => d.name));

    // 指南里的英文名不在本字典里（旧名/废名）→ 记录中文名，供「旧名搭桥」使用
    const bridgeByCn = new Map();
    for (const entry of guides.entries) {
        if (!entry.en || dictNames.has(entry.en)) continue;
        if (!bridgeByCn.has(entry.cn)) bridgeByCn.set(entry.cn, entry);
    }

    // 只统计数量（不再逐条列出）；unmatchedBlank / conflicts / orphans 会逐条打印
    const stat = {
        matched: 0, sameName: 0, variant: 0, bridged: 0, special: 0,
        unmatchedKept: 0, unmatchedBlank: [], conflicts: [], orphans: [],
    };
    const result = [];

    for (const dict of dictEntries) {
        const record = { dict, status: '', value: dict.value, commented: dict.commented, guide: null };
        const list = byEn.get(dict.name);
        let guide = null;

        if (list && list.length > 0) {
            guide = pickGuide(list, dict.value);
            if (opts.preferExisting && dict.value && dict.value !== guide.cn) {
                record.status = 'prefer-existing';
                stat.conflicts.push({ name: dict.name, old: dict.value, guide: [...new Set(list.map((e) => e.cn))].join(' / ') });
            } else {
                record.status = 'matched';
            }
        } else if (dict.value && bridgeByCn.has(dict.value)) {
            guide = bridgeByCn.get(dict.value);
            record.status = 'bridged';
        } else if (byKey.has(normalize(dict.name)) && pickByKey(byKey.get(normalize(dict.name)), dict.name, dictNames)) {
            // 同名直配（中文标签名就是英文标签名，如 scp/_cc）或只差前导下划线的变体（_ru ← ru）
            guide = pickByKey(byKey.get(normalize(dict.name)), dict.name, dictNames);
            record.status = (guide.en === dict.name || (!guide.en && guide.cnTag === dict.name)) ? 'same-name' : 'variant';
        } else if (dict.value) {
            record.status = 'unmatched-kept';
            stat.unmatchedKept++;
        } else {
            record.status = 'unmatched-blank';
            record.commented = true;
            stat.unmatchedBlank.push(dict.name);
        }

        if (guide) {
            record.guide = guide;
            if (record.status !== 'prefer-existing') record.value = guide.cn;
            // 变体匹配只是「推断」，不覆盖条目里已有的译文
            if (record.status === 'variant' && dict.value && dict.value !== guide.cn) {
                record.status = 'variant-kept';
                record.value = dict.value;
            }
            if (dict.value && dict.value !== guide.cn) stat.conflicts.push({ name: dict.name, old: dict.value, guide: guide.cn });
            if (guide.special) {
                record.status = 'special';
                record.commented = true;
                stat.special++;
            } else if (record.status === 'bridged') {
                stat.bridged++;
            } else if (record.status === 'variant' || record.status === 'variant-kept') {
                stat.variant++;
            } else if (record.status === 'same-name') {
                stat.sameName++;
            } else if (record.status === 'matched') {
                stat.matched++;
            }
        }
        result.push(record);
    }

    for (const entry of guides.entries) {
        if (entry.en && !dictNames.has(entry.en)) stat.orphans.push({ cnTag: entry.cnTag, cn: entry.cn, en: entry.en });
    }
    return { result, stat };
}

// ---------------------------------------------------------------- 主流程

function report(guides, stat, dictCount, sourceConflicts, ref, opts) {
    if (opts.quiet) return;
    const withEn = guides.entries.filter((e) => e.en);

    const multiEn = new Map();
    for (const e of withEn) {
        if (!multiEn.has(e.cn)) multiEn.set(e.cn, new Set());
        multiEn.get(e.cn).add(e.en);
    }
    const multiEnList = [...multiEn].filter(([, s]) => s.size > 1);
    const multiCn = new Map();
    for (const e of withEn) {
        if (!multiCn.has(e.en)) multiCn.set(e.en, new Set());
        multiCn.get(e.en).add(e.cn);
    }
    const multiCnList = [...multiCn].filter(([, s]) => s.size > 1);

    // 指导里配了英文、但那个英文并不在英文标签列表里的中文标签（只报告，不写进文件）
    const orphanCn = new Map();
    for (const o of stat.orphans) {
        if (!orphanCn.has(o.cnTag)) orphanCn.set(o.cnTag, { cn: o.cn, en: new Set() });
        orphanCn.get(o.cnTag).en.add(o.en);
    }
    const orphanEn = new Set(stat.orphans.map((o) => o.en));

    // 每段提示之间空一行；缩进的明细行紧跟它所属的那一段
    const blocks = [];
    blocks.push([`条目 ${dictCount}｜指南候选 ${guides.entries.length}（带英文名 ${withEn.length}）`]);
    const matched = [
        `精确匹配 ${stat.matched}｜同名直配 ${stat.sameName}｜下划线变体 ${stat.variant}｜旧名搭桥 ${stat.bridged}｜特殊区块 ${stat.special}`,
        `未匹配但有译文（保留原状）${stat.unmatchedKept}｜未匹配且无译文（已注释）＝未敲定翻译 ${stat.unmatchedBlank.length}`,
    ];
    if (stat.unmatchedBlank.length) matched.push('   未敲定：' + stat.unmatchedBlank.join('，'));
    blocks.push(matched);
    if (ref.filled.length > 0) {
        blocks.push([
            `【参照表】补入译文并启用 ${ref.filled.length} 个（${opts.refs.join('、')}）：`,
            ...ref.filled.map((f) => `   ${f.name} - ${f.cn}`),
        ]);
    }
    if (ref.overrode.length > 0) {
        blocks.push([
            `【参照表】按 --ref-first 采用参照表译文、覆盖指导页 ${ref.overrode.length} 个：`,
            ...ref.overrode.map((o) => `   ${o.name}：指导页「${o.from}」→ 参照表「${o.to}」`),
        ]);
    }
    if (ref.extraTags.size > 0) {
        const names = [...ref.extraTags];
        blocks.push([
            `【参照表】参照表里的其它英文标签 ${names.length} 个（本字典没有，已忽略：不新增、不删除条目）：`
            + names.slice(0, 20).join('，') + (names.length > 20 ? ' …' : ''),
        ]);
    }
    blocks.push([`【统计】一个中文对应多个英文 ${multiEnList.length} 个：` + (multiEnList.map(([cn, s]) => `${cn} → ${[...s].join(' / ')}`).join('；') || '（无）')]);
    blocks.push([`【统计】一个英文对应多个中文 ${multiCnList.length} 个：` + (multiCnList.map(([en, s]) => `${en} → ${[...s].join(' / ')}`).join('；') || '（无）')]);
    blocks.push([
        `【统计】有英文对应、但英文不在英文标签列表里的中文标签 ${orphanCn.size} 个（涉及 ${orphanEn.size} 个英文名；只报告，不写入文件）：`,
        ...(orphanCn.size ? [...orphanCn].map(([, v]) => `   ${v.cn} - ${[...v.en].join(' / ')}`) : ['   （无）']),
    ]);
    if (stat.conflicts.length) {
        blocks.push([
            `【校对】译文与现有不一致 ${stat.conflicts.length} 个：`,
            ...stat.conflicts.map((c) => `   ${c.name}：现有「${c.old || '（空）'}」／指南「${c.guide}」`),
        ]);
    }
    if (sourceConflicts.length) {
        blocks.push([
            `【校对】指南内部不一致 ${sourceConflicts.length} 个（同一中文标签在不同页面挂了不同英文名，采用优先级更高页面的）：`,
            ...sourceConflicts.map((c) => `   ${c.cnTag}：采用 ${c.kept.join(' / ') || '（无）'}；`
                + c.dropped.map((d) => `丢弃 ${d.source} 的 ${d.en}`).join('，')),
        ]);
    }

    process.stderr.write('\n' + blocks.map((b) => b.join('\n')).join('\n\n') + '\n');
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) return printHelp();

    // 依次解析三个页面，先原样收下来，再做全局过滤
    const perSource = new Map();
    const collected = [];
    for (const src of SOURCES) {
        const { html, from } = await loadSource(src, opts);
        const body = bodyOf(html);
        const found = [];
        for (const section of src.sections) {
            const slice = sliceByHeading(body, section.from, section.to);
            found.push(...collectEntries(slice.html, slice.offset, src.key));
        }
        if (found.length === 0) throw new Error(src.key + ' 没解析出任何标签，页面结构可能变了');
        perSource.set(src.key, { found, from });
        collected.push(...found);
    }

    // 主页面写明「已经不为英文维基使用」的那批中文标签，任何页面里的同名条目都一并忽略：
    // 既不进统计，也不会被写进字典（例如故事指导里仍写着旧名 历史性，而现名是 历史）
    const deprecatedTags = new Set(collected.filter((e) => e.ignored).map((e) => e.cnTag));
    const keptFrom = (list) => list.filter((e) => !e.ignored && !deprecatedTags.has(e.cnTag));
    for (const [key, { found, from }] of perSource) {
        if (!opts.quiet) process.stderr.write(`${key}：${keptFrom(found).length} 条候选（${from}）\n`);
    }
    const guides = { entries: keptFrom(collected) };

    // 子页面还写着旧英文名时，只保留优先级更高页面的配对
    const resolved = resolveCrossSource(guides.entries);
    guides.entries = resolved.entries;

    const text = fs.readFileSync(opts.file, 'utf8');
    const lines = splitLines(text);
    const dictEntries = [];
    lines.forEach((line, index) => {
        const eol = eolOf(line);
        const m = ENTRY_RE.exec(eol ? line.slice(0, -eol.length) : line);
        if (!m) return;
        dictEntries.push({ index, name: m[3], value: m[4], commented: Boolean(m[2]), indent: m[1], eol });
    });
    if (dictEntries.length === 0) throw new Error('在 ' + opts.file + ' 里没有找到任何条目');

    const { result, stat } = matchEntries(dictEntries, guides, opts);

    // 参照表：只补译文，英文标签以本字典为准
    let ref = { filled: [], overrode: [], extraTags: new Set() };
    if (opts.refs.length > 0) {
        ref = applyReferences(result, stat, collectReferences(opts.refs, new Set(dictEntries.map((d) => d.name))), opts);
    }

    let reCommented = 0;
    for (const record of result) {
        if (opts.commentAllUnmatched && record.status === 'unmatched-kept') {
            if (!record.commented) reCommented++;
            record.commented = true;
        }
        lines[record.dict.index] = record.dict.indent + (record.commented ? '//' : '')
            + '"' + record.dict.name + '": "' + record.value + '",' + record.dict.eol;
    }
    const output = lines.join('');

    if (opts.out) {
        fs.writeFileSync(opts.out, output, 'utf8');
        if (!opts.quiet) process.stderr.write('已写出 ' + opts.out + '（' + dictEntries.length + ' 个条目）\n');
    } else {
        process.stdout.write(output);
    }
    report(guides, stat, dictEntries.length, resolved.conflicts, ref, opts);
    if (!opts.quiet && reCommented > 0) process.stderr.write(`--comment-all-unmatched：另有 ${reCommented} 个原本启用的条目被改为注释\n`);
}

main().catch((err) => {
    process.stderr.write('错误：' + err.message + '\n');
    process.exitCode = 1;
});
