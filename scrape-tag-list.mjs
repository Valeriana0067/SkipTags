#!/usr/bin/env node
/**
 * scrape-tag-list.mjs
 *
 * 从 05command 技术中心标签列表页的正文里抓取「全部标签名，且仅有标签名」，
 * 按本地 TagList.js 的格式输出为 JS 字典（分类注释 + 空行分隔，条目值留空）。
 *
 * 用法：
 *   node scrape-tag-list.mjs                                   抓线上页面，字典写到 stdout
 *   node scrape-tag-list.mjs --out TagList.gen.js              抓线上页面，字典写到文件
 *   node scrape-tag-list.mjs --file page.html                  改用本地保存的 HTML（离线、可复现）
 *   node scrape-tag-list.mjs --merge TagList.js --out TagList.js   覆盖式更新（推荐）
 *
 * 参数：
 *   --url <url>       页面地址，默认 https://05command.wikidot.com/tech-hub-tag-list
 *   --file <path>     改为读取本地 HTML 文件
 *   --merge <path>    覆盖式更新（别名 --overwrite），以新抓取的表格整段替换旧字典：
 *                     ① 顶部注释（const FullTagList 之前的全部内容）原样保留；
 *                     ② 从 const FullTagList = 起重新生成，分类与顺序完全按页面来；
 *                     ③ 同名标签的译文与注释状态沿用旧文件，新标签值为 "";
 *                     ④ 旧文件有、页面已无的标签随覆盖一起消失，只在 stderr 报告（含译文），
 *                        便于核对是否属于页面改名后再手工搬译文。
 *   --out <path>      输出路径，缺省写 stdout；覆盖式更新可直接写回原文件（先完整读取再写）
 *   --eol <crlf|lf>   换行符，默认 crlf（与现有 TagList.js 一致）
 *   --exclude a,b,c   忽略这些标签
 *   --comment-untranslated  页面新增且暂无译文的标签写成注释行（沿用旧文件里 //"x": "", 的写法）
 *   --quiet           不向 stderr 打印统计信息
 *
 * 分类注释：由 SECTION_MAP 决定，构建后强制全局唯一——同名子分类自动用父分类限定
 * （例如 Genre 与 Art 都有 Style，输出为 "Genre Style" 与 "Art Style"）。
 *
 * 「只抓标签名」的四道过滤：
 *   1. 只在 #page-content 的 tabview 正文内查找，页面底部 page-tags 里页面自身的标签、
 *      页面标题 / 导航 / TOC / 页脚一律排除；
 *   2. 只认标签定义行 <li><strong><a href="…/system:page-tags/tag/NAME">NAME</a></strong>，
 *      "&#8212;" 之后的说明文字全部丢弃；
 *   3. 交叉引用提示行（如 <li><em>Conflicts with 'scp'</em></li>）没有链接，一律不当作标签，
 *      因此提示里出现的名字不会被误抓；
 *   4. 标签名取自链接 URL 的 tag 段（并解码 HTML 实体，如 s&amp;c-plastics → s&c-plastics），
 *      不用显示文本，同一标签跨分类只保留首次出现。
 */

import fs from 'node:fs';

const DEFAULT_URL = 'https://05command.wikidot.com/tech-hub-tag-list';
const USER_AGENT = 'SkipTags-tag-scraper/1.0 (local TagList.js maintenance)';

/**
 * 页面分类 → 输出注释名的映射（按页面顺序排列）。
 * label: 该标签页对应的注释名；subs: 三级标题 → 子分类注释名，
 * null 表示并入上一层（如 "Supplement pages" 并入 //Major），
 * 相邻且同名时自然合成一段（Genre 页首个 "Genre" 小标题并入 //Genre）。
 * 注释名要求全局唯一：撞名会由 ensureUniqueLabels 用父分类限定
 * （Genre 与 Art 都有 Style → "Genre Style" / "Art Style"）并在 stderr 提示。
 * 页面新增分类时，这里补一条即可；未登记的标签页会用页面原本的标题作为注释名。
 */
const SECTION_MAP = [
    { tab: 'Top Level', label: 'Top Level' },
    { tab: 'Major Page Tags', label: 'Major', subs: { 'Supplement pages': null } },
    { tab: 'Content Markers', label: 'Markers' },
    { tab: 'Object Classes', label: 'Object Class' },
    {
        tab: 'SCP Attributes', label: 'Attributes',
        subs: {
            Entity: 'Entity',
            Animal: 'Animal',
            Biological: 'Biological',
            Mental: 'Mental',
            Physical: 'Physical',
            Environment: 'Environment',
            Artificial: 'Artifical',
            Other: 'Other',
        },
    },
    {
        tab: 'Genre', label: 'Genre',
        subs: {
            Genre: 'Genre',
            'Genre Elements': 'Elements',
            Themes: 'Themes',
            Setting: 'Setting',
            Style: 'Style',
            Other: 'Genre Other',
        },
    },
    { tab: 'Art', label: 'Art', 
        subs: { 
            Style: 'Art Style', 
            Content: 'Content' 
        } 
    },
    {
        tab: 'Groups', label: 'Groups',
        subs: { 
            Departments: 'Depts', 
            'Groups of Interest': 'GOI', 
            'Anomalous Entities': 'Anomalous' 
        },
    },
    { tab: 'GoI Formats', label: 'GOI Formats' },
    { tab: 'Canons', label: 'Canons' },
    { tab: 'Series', label: 'Series' },
    {
        tab: 'Characters', label: 'Characters',
        subs: {
            'Foundation Employees': 'Employees',
            'SCP Objects': 'SCPs',
            'Persons of Interest': 'POI',
            'Pluripotent Entities': 'Plur. Entity',
        },
    },
    { tab: 'Locations', label: 'Locations' },
    { tab: 'Objects', label: 'Objects' },
    { tab: 'Staff Process', label: 'Staff Process' },
    {
        tab: 'Events', label: 'Events',
        subs: { 
            'Official Contests': 'Official Contests', 
            'Unofficial Contests': 'Unofficial Contests' },
    },
    { tab: 'Translation', label: 'Translation', 
        subs: { 
        'Language Codes': 'Language Codes' 
        } 
    },
];

// ---------------------------------------------------------------- 参数

function parseArgs(argv) {
    const opts = {
        url: DEFAULT_URL, file: null, merge: null, out: null,
        eol: 'crlf', exclude: [], commentUntranslated: false, quiet: false, help: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        const value = () => {
            const v = argv[++i];
            if (v === undefined) throw new Error(flag + ' 缺少参数');
            return v;
        };
        switch (flag) {
            case '--url': opts.url = value(); break;
            case '--file': opts.file = value(); break;
            case '--merge': case '--overwrite': opts.merge = value(); break;
            case '--out': case '-o': opts.out = value(); break;
            case '--eol': opts.eol = value().toLowerCase(); break;
            case '--exclude': opts.exclude.push(...value().split(',').map((s) => s.trim()).filter(Boolean)); break;
            case '--comment-untranslated': opts.commentUntranslated = true; break;
            case '--quiet': case '-q': opts.quiet = true; break;
            case '--help': case '-h': opts.help = true; break;
            default: throw new Error('未知参数：' + flag);
        }
    }
    if (opts.eol !== 'crlf' && opts.eol !== 'lf') throw new Error('--eol 只能是 crlf 或 lf');
    return opts;
}

function printHelp() {
    const src = fs.readFileSync(new URL(import.meta.url), 'utf8');
    process.stdout.write(src.slice(src.indexOf('/**'), src.indexOf('*/') + 2) + '\n');
}

// ---------------------------------------------------------------- HTML 工具

const NAMED_ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
    ndash: '\u2013', mdash: '\u2014', hellip: '\u2026', middot: '\u00b7', times: '\u00d7',
};

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

/** 去掉标签并压平空白，用于标题等纯文本。 */
function plainText(html) {
    return decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

/** 取出 #page-content 正文，并在页面自身标签栏之前截断；脚本与注释一并清掉。 */
function extractBody(html) {
    const contentAt = html.search(/<div[^>]*\bid="page-content"/i);
    const from = contentAt === -1 ? 0 : contentAt;
    let end = html.length;
    for (const marker of ['<div class="page-tags"', '<div id="page-info"', '<div class="page-info"']) {
        const at = html.indexOf(marker, from);
        if (at !== -1 && at < end) end = at;
    }
    return html.slice(from, end)
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '');
}

/** 按 tabview 的标签页切块；页面结构变了就退化为整段正文。 */
function splitTabs(body) {
    const re = /<div[^>]*\bid="wiki-tab-[^"]*"[^>]*>/gi;
    const starts = [];
    let m;
    while ((m = re.exec(body)) !== null) starts.push({ tag: m.index, content: m.index + m[0].length });
    if (starts.length === 0) return [{ title: null, html: body }];
    return starts.map((s, i) => ({
        title: null,
        html: body.slice(s.content, i + 1 < starts.length ? starts[i + 1].tag : body.length),
    }));
}

/** 一个 <li> 里所有标签链接的名字（一般只有主标签一个）。 */
function tagLinks(html) {
    const names = [];
    const re = /page-tags\/tag\/([^"#?\s]+)/gi;
    let m;
    while ((m = re.exec(html)) !== null) names.push(decodeEntities(m[1]).trim());
    return names;
}

/**
 * 从 <li> 里取标签名：只认加粗的标签定义行。
 * 没有 <strong> 时仅当该行只含一个标签链接才采纳，避免把说明文字里的引用当成标签。
 */
function tagNameFromListItem(li) {
    const strong = li.match(/<strong\b[^>]*>[\s\S]*?<\/strong>/i);
    if (strong) {
        const names = tagLinks(strong[0]);
        if (names.length > 0) return names[0];
    }
    const names = tagLinks(li);
    return names.length === 1 ? names[0] : null;
}

/** 顺序取出正文里的标题与标签定义。 */
function parseItems(html) {
    const items = [];
    const re = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>|<li\b[^>]*>([\s\S]*?)<\/li>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
        if (m[1] !== undefined) {
            items.push({ kind: 'heading', level: Number(m[1]), text: plainText(m[2]) });
        } else {
            const name = tagNameFromListItem(m[3]);
            if (name) items.push({ kind: 'tag', name });
        }
    }
    return items;
}

// ---------------------------------------------------------------- 归类

function sectionMapFor(title) {
    if (!title) return null;
    return SECTION_MAP.find((s) => s.tab === title)
        || SECTION_MAP.find((s) => s.tab.toLowerCase() === String(title).toLowerCase())
        || null;
}

function subLabelFor(map, heading) {
    if (map && Object.prototype.hasOwnProperty.call(map.subs || {}, heading)) return map.subs[heading];
    if (map && Object.keys(map.subs || {}).length === 0 && map.label) return map.label;
    return heading;
}

/**
 * 强制分类注释全局唯一：同名子分类用父分类限定（Genre 与 Art 都有 Style →
 * "Genre Style" / "Art Style"），限定后仍冲突就补序号，改名结果回传给报告。
 */
function ensureUniqueLabels(sections) {
    const renamed = [];
    const counts = new Map();
    for (const section of sections) counts.set(section.label, (counts.get(section.label) || 0) + 1);

    const used = new Set();
    for (const section of sections) {
        let label = section.label;
        if (counts.get(label) > 1 && section.isSub && section.parent) {
            label = section.parent + ' ' + label;
            renamed.push({ from: section.label, to: label });
        }
        if (used.has(label)) {
            const base = label;
            let n = 2;
            while (used.has(base + ' (' + n + ')')) n++;
            label = base + ' (' + n + ')';
            renamed.push({ from: base, to: label });
        }
        used.add(label);
        section.label = label;
    }
    return renamed;
}

/**
 * 把标签页条目整理成 [{label, tags}]，按页面顺序；
 * 相邻同名分类合并成一段，跨分类重复出现只保留首次，最后保证分类名唯一。
 */
function buildSections(blocks, exclude) {
    const sections = [];
    const owner = new Map();
    const duplicates = [];
    let current = null;
    let lastLabel = null;

    blocks.forEach((block, index) => {
        const title = block.title || 'Tab ' + (index + 1);
        const map = sectionMapFor(title);
        const parent = map ? map.label : title;
        let pending = null;
        for (const item of block.items) {
            if (item.kind === 'heading') {
                if (item.level <= 2) continue;      // 标签页标题由 SECTION_MAP 决定
                pending = subLabelFor(map, item.text);
                continue;
            }
            if (exclude.has(item.name)) continue;
            const label = pending || parent;
            if (label !== lastLabel) {
                current = { label, parent, isSub: pending !== null, tags: [] };
                sections.push(current);
                lastLabel = label;
            }
            if (owner.has(item.name)) {
                duplicates.push({ name: item.name, first: owner.get(item.name), again: label });
                continue;
            }
            owner.set(item.name, label);
            current.tags.push(item.name);
        }
    });

    const kept = sections.filter((s) => s.tags.length > 0);
    const renamed = ensureUniqueLabels(kept);
    return { sections: kept.map((s) => ({ label: s.label, tags: s.tags })), duplicates, renamed };
}

// ---------------------------------------------------------------- 生成

function renderDictionary(sections, eol, meta) {
    const lines = [];
    if (meta.includeHeader) {
        lines.push('//source: ' + meta.source);
        lines.push('//tags: ' + meta.tagCount);
        lines.push('');
    }
    lines.push('const FullTagList =');
    lines.push('{');
    sections.forEach((section, index) => {
        if (index > 0) lines.push('    //');
        lines.push('    //' + section.label);
        for (const entry of section.entries) {
            lines.push('    ' + (entry.commented ? '//' : '') + '"' + entry.name + '": "' + entry.value + '",');
        }
    });
    lines.push('    //');
    lines.push('}');
    return lines.join(eol);
}

/** 截出 `const FullTagList` 之前的顶部注释；覆盖更新时原样保留这一段。 */
function splitHeader(text) {
    const at = /^[ \t]*(?:const|var|let)\s+FullTagList\s*=/m.exec(text);
    return at ? text.slice(0, at.index) : '';
}

/** 解析旧字典的条目：name → {value, commented}，译文与注释状态一并记下。 */
function parseExistingEntries(text) {
    const entries = new Map();
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        const m = line.match(/^(?:\/\/\s*)?"([^"]+)"\s*:\s*"(.*)"\s*,?\s*$/);
        if (!m || entries.has(m[1])) continue;
        entries.set(m[1], { value: m[2], commented: line.startsWith('//') });
    }
    return entries;
}

/**
 * 覆盖式更新：分类结构、分类顺序、成员与段内顺序全部按页面来；
 * 旧文件只贡献两样东西——同名标签的译文，以及它原本是否被注释掉。
 */
function overwriteSections(oldEntries, scraped, opts) {
    const sections = [];
    const added = [];
    const carried = [];
    for (const section of scraped) {
        const entries = section.tags.map((name) => {
            const old = oldEntries.get(name);
            if (old) {
                carried.push(name);
                return { name, value: old.value, commented: old.commented };
            }
            added.push(name);
            return { name, value: '', commented: Boolean(opts.commentUntranslated) };
        });
        sections.push({ label: section.label, entries });
    }

    const onPage = new Set(scraped.flatMap((s) => s.tags));
    const stale = [...oldEntries.entries()]
        .filter(([name]) => !onPage.has(name))
        .map(([name, entry]) => ({ name, ...entry }));
    return { sections, added, carried, stale };
}

// ---------------------------------------------------------------- 主流程

async function loadHtml(opts) {
    if (opts.file) return fs.readFileSync(opts.file, 'utf8');
    const res = await fetch(opts.url, { headers: { 'user-agent': USER_AGENT, accept: 'text/html' } });
    if (!res.ok) throw new Error('抓取失败：HTTP ' + res.status + ' ' + res.statusText);
    return await res.text();
}

function report(result, opts) {
    if (opts.quiet) return;
    const write = (line) => process.stderr.write(line + '\n');
    if (result.renamed?.length) {
        write('分类名撞名，已用父分类限定：'
            + result.renamed.map((r) => `${r.from} → ${r.to}`).join('，')
            + '（要换名字就改 SECTION_MAP 里对应的 subs）');
    }
    if (result.added) {
        write('沿用旧译文 ' + result.carried.length + ' 个；页面新标签 ' + result.added.length + ' 个（值为 ""）：'
            + (result.added.join(', ') || '（无）'));
        const shown = result.stale.slice(0, 30).map((s) => (s.value ? `${s.name}=${s.value}` : s.name));
        write('旧文件有、页面已无，本次随覆盖删除 ' + result.stale.length + ' 个：'
            + (shown.join(', ') || '（无）') + (result.stale.length > 30 ? ' …' : ''));
        if (result.stale.some((s) => s.value)) write('  ↑ 带 = 的条目原本有译文，若是页面改名请把译文搬到新名字上（git diff 可复核）');
    }
    if (result.duplicates?.length) {
        write('页面内重复出现的标签 ' + result.duplicates.length + ' 个：'
            + result.duplicates.map((d) => `${d.name}（${d.first} / ${d.again}）`).join('，'));
    }
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) return printHelp();

    const html = await loadHtml(opts);
    const blocks = splitTabs(extractBody(html));
    blocks.forEach((block, index) => {
        block.items = parseItems(block.html);
        const heading = block.items.find((item) => item.kind === 'heading' && item.level === 2);
        block.title = heading ? heading.text : 'Tab ' + (index + 1);
    });

    const scraped = buildSections(blocks, new Set(opts.exclude));
    const tagCount = scraped.sections.reduce((sum, section) => sum + section.tags.length, 0);

    let sections;
    let header = '';
    let result = { renamed: scraped.renamed, duplicates: scraped.duplicates };
    if (opts.merge) {
        const oldText = fs.readFileSync(opts.merge, 'utf8');
        header = splitHeader(oldText);                                          // 顶部注释原样保留
        if (!header && !/FullTagList/.test(oldText)) {
            process.stderr.write('提示：' + opts.merge + ' 里没找到 const FullTagList =，顶部注释按空处理\n');
        }
        result = { ...overwriteSections(parseExistingEntries(oldText), scraped.sections, opts), ...result };
        sections = result.sections;
    } else {
        sections = scraped.sections.map((section) => ({
            label: section.label,
            entries: section.tags.map((name) => ({ name, value: '', commented: Boolean(opts.commentUntranslated) })),
        }));
    }

    const eol = opts.eol === 'lf' ? '\n' : '\r\n';
    const body = renderDictionary(sections, eol, {
        includeHeader: !opts.merge,
        source: opts.file ? opts.file : opts.url,
        tagCount,
    });
    const output = header + body;

    if (opts.out) {
        fs.writeFileSync(opts.out, output, 'utf8');
        if (!opts.quiet) process.stderr.write('已写出 ' + opts.out + '：' + tagCount + ' 个标签 / ' + sections.length + ' 个分类\n');
    } else {
        process.stdout.write(output + '\n');
    }

    report(result, opts);
}

main().catch((err) => {
    process.stderr.write('错误：' + err.message + '\n');
    process.exitCode = 1;
});
