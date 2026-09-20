# SkipTags

把**英文站（SCP Wiki）的标签**批量换算成**中文站（SCP-CN）标签**的小工具，外加两个用来维护标签对照表的脚本。

日常用法只有一件事：打开 `Interface.html`，把英文标签粘进去，点"翻译"，拿到可以直接用到中文站页面上的中文标签串。剩下的三个文件负责让那张对照表始终跟得上两边站点。

```
05command 技术中心标签总表 ──scrape-tag-list.mjs ──► 三个中文标签指导页 ── fill-tag-translations.mjs ──► TagList.js
                                                                                                        │
                                                                                        Interface.html ─┴─► 中文标签串
```

## 文件一览

| 文件 | 作用 | 需要手工维护 |
| --- | --- | --- |
| `Interface.html` | 网页界面：输入框、输出框、"不需/暂无翻译"框、翻译按钮 | 否 |
| `TagConv.js` | 界面逻辑：切分输入、查表、把查不到的标签单独列出 | 否 |
| `TagList.js` | **唯一数据源**：英文标签 → 中文译名的字典 | 是（译文） |
| `scrape-tag-list.mjs` | 抓取英文标签总表，生成 / 覆盖字典结构 | 否（分类名映射除外） |
| `fill-tag-translations.mjs` | 抓取三个中文标签指导页，回填中文译名 | 否 |
| 其它可能出现的 `TagList*.js` | 两类：跑脚本产生的中间产物（如 `TagList1.js`，可随时删除）与手工维护的对照表（如 `TagListAssist.js`，可用 `--ref` 当参照表） | 手工表是 |

运行环境：**Node.js 18 或更高**。两个脚本都零依赖，只用内置模块；联网抓取时只访问 05command 与 scp-wiki-cn。

## 一、日常使用：英文标签转中文

1. 用浏览器打开 `Interface.html`（脚本以相对路径加载 `TagList.js` 与 `TagConv.js`，三个文件要放在同一个目录）。
2. 在"输入"框里粘贴英文标签，**空格、逗号、换行**都可以作分隔符。
3. 点"翻译"：
   - **输出**：能查到译名的标签，按中文列出；
   - **不需/暂无翻译**：字典里没有的标签，原样列出，表示这些标签在中文站直接用英文原名或不使用。

输入会被转成小写，并自动去掉 `'` `"` `\` `/` 与制表符等字符，所以从页面源码里整段复制也没问题。

> ⚠️ `TagConv.js` 的判定是"标签在字典里就取它的值"。因此**没有译文的条目必须保持注释状态**（写作 `//"english": "",`），否则它会被当成有译名，在输出里留下一个空白项。两个维护脚本都遵守这条约定。

## 二、维护字典

`TagList.js` 的内容分两半：

- **顶部注释**（`const FullTagList =` 之前）——人工维护，脚本原样保留；
- **字典主体**——由 `scrape-tag-list.mjs` 按英文站总表重建，由 `fill-tag-translations.mjs` 填中文。

### 2.1 更新英文标签结构

```powershell
# 覆盖式更新（推荐，可写回原文件；脚本会先完整读取再写）
node scrape-tag-list.mjs --merge TagList.js --out TagList.js

# 先看效果不落盘：输出到 stdout
node scrape-tag-list.mjs --merge TagList.js

# 用本地保存的页面（离线、可复现，推荐长期保留快照）
node scrape-tag-list.mjs --file .\snapshot\tech-hub-tag-list.html --merge TagList.js --out TagList.js
```

| 参数 | 说明 |
| --- | --- |
| `--url <url>` | 页面地址，默认 `https://05command.wikidot.com/tech-hub-tag-list` |
| `--file <path>` | 改为读取本地 HTML 快照 |
| `--merge <path>` | 覆盖式更新，别名 `--overwrite`：保留顶部注释，从 `const FullTagList =` 起整段重建；同名标签沿用旧译文与注释状态；页面已无的标签随覆盖删除并列入报告（含原译文，便于搬到新名字上） |
| `--out <path>` | 输出路径，缺省写 stdout |
| `--eol crlf\|lf` | 换行符，默认 `crlf`（与现有文件一致） |
| `--exclude a,b,c` | 本次忽略这些标签 |
| `--comment-untranslated` | 新增且暂无译文的标签写成注释行 |
| `--quiet` | 不打印统计 |

抓取时**只取标签名**，四道过滤保证不混入别的内容：只在 `#page-content` 的标签页正文里找（页面底部"页面自身标签"、导航、目录、页脚全部排除）；只认加粗的标签定义行；描述里的交叉引用提示（`Conflicts with 'scp'` 之类）没有链接，不算标签；标签名取自链接地址而非显示文本，并解码 `&amp;` 这类实体。

分类注释由脚本顶部的 `SECTION_MAP` 决定，与英文站标签页一一对应（`Top Level`、`Major`、`Markers`、`Object Class`、`Entity`…`Artifical`、`Genre`、`Elements`、`Themes`、`Setting`、`Style`、`Genre Other`、`Art`、`Art Style`、`Content`、`Depts`、`GOI`、`Anomalous`、`GOI Formats`、`Canons`、`Series`、`Employees`、`SCPs`、`POI`、`Plur. Entity`、`Locations`、`Objects`、`Staff Process`、`Events`、`Official Contests`、`Unofficial Contests`、`Translation`、`Language Codes`）。注释名要求全局唯一，撞名时脚本会自动用父分类限定（例如 `Genre` 与 `Art` 都有 `Style`），并在报告里说明。

### 2.2 回填中文译文

```powershell
# 联网抓取三个中文指导页（首次会缓存到临时目录）
node fill-tag-translations.mjs --file TagList.js --out TagList.js

# 指定快照目录（目录里没有对应文件才联网抓取）
node fill-tag-translations.mjs --file TagList.js --dir .\snapshot --out TagList.js

# 完全离线，只读快照
node fill-tag-translations.mjs --file TagList.js --dir .\snapshot --offline --out TagList.js

# 同时用手工维护的对照表补译文（只补空，不改英文标签）
node fill-tag-translations.mjs --file TagList.js --out TagList.js --ref TagList.manual.js

# 让参照表的译文优先于指导页（仍只作用于本字典里已有的英文标签）
node fill-tag-translations.mjs --file TagList.js --out TagList.js --ref TagList.manual.js --ref-first
```

中文一侧来自三个页面：`scp-wiki-cn/tag-guide`（只取正文的"主要标签""英语站相关标签"两节）、`tale-tagging-guide`（全篇）、`art-tagging-guide`（全篇）。页面上每条标签写作"中文标签（english-tag）"，中英两侧可能是链接也可能是纯文本，脚本两种都认。

| 参数 | 说明 |
| --- | --- |
| `--file <path>` | 要更新的字典，默认 `TagList.js` |
| `--out <path>` | 输出路径，缺省写 stdout |
| `--dir <path>` | 三个中文页面的快照目录，默认系统临时目录下 `skiptags-cn-guides` |
| `--offline` | 只用快照，不联网 |
| `--ref <path>` | 参照表：另一份既有的标签对照表（可重复，先给出的优先），只用来补译文 |
| `--ref-first` | 参照表的译文优先于指导页（仍然只作用于本字典里已有的英文标签） |
| `--prefer-existing` | 同一英文标签有多种中文译名时保留文件里现有的译法（默认采用指导页的） |
| `--comment-all-unmatched` | 未被指导页覆盖的条目一律注释（默认只注释没有译文的那些） |
| `--quiet` | 不打印统计 |

匹配按优先级依次尝试：

1. **精确匹配**——指导页里有同名英文标签，采用它的中文译名；指导页与现有译文不一致时保留指导页的写法并列入报告；
2. **旧名搭桥**——指导页写的是英文旧名（如 `resources`、`cephalopodic`、`leporine`），而中文名与条目现有译文相同，视为同一条并沿用；
3. **同名直配**——中文标签名本身就是英文标签名（如 `scp`、`meta`、`delta-t`、`_cc`）；
4. **下划线变体**——只差前导下划线（`_adult ← adult`、`_ru ← ru`）。变体属于推断，只在条目还没有译文时才填，不覆盖已有译文；
5. **未匹配**——已有译文的保留原状，没有译文的写成注释行并计入"未敲定翻译"。

两类特殊区块另行处理：

- **工作人员专用**（`工作人员专用` 标题区块）：照常匹配中文译名，但一律写成注释行（`//"admin": "管理",`），且不计入"未敲定翻译"；
- **已经不为英文维基使用**（主页面"未分類"区块的提示语）：**整段忽略**。被点名的中文标签名会被收集成停用集合，任何页面里的同名条目都不再采用——既不进统计，也不会写进文件。典型例子是 `历史性`：主页面注明"在中文站不同于'历史性'"，故事指导里还留着旧名，忽略后 `historical` 会取到正确的现名 `历史`。

指导页之间还可能互相矛盾（同一个中文标签在不同页面挂了不同英文名），此时以优先级更高的页面为准（主页面 > 故事指导 > 艺作指导），被丢弃的配对列入报告。

整个回填过程**只重写条目行**：分类注释、条目顺序、头部注释、以及每条原有的译名与注释状态都不会被动。

#### 参照表：把手工维护的译文带进来

中文标签指导的更新往往滞后于英文站，手工补的译文如果只写在别处（旧版 `TagList.js`、自建的对照表），重新生成字典时就会丢。用 `--ref` 把那份表作为补充来源即可：

- 只读取其中的**「英文标签 → 中文译文」**，其它一律不用；被注释掉的条目也会读取（它的注释状态是那份文件自己的事），空译文忽略；
- **只增不改**：只往最终结果里补译文，**绝不因为参照表新增、删除或移动任何英文标签**——英文标签一律以本字典为准，参照表里多出来的标签只会被计数并忽略；
- 默认**只补空**：文件里已有译文、或指导页已给出译文的条目都不会被覆盖；想让手工值优先于指导页，加 `--ref-first`（被 `--prefer-existing` 要求保留的译文仍不会被覆盖）；
- 补入译文的条目会被**启用**（去掉行首的 `//`）：不管是写成正式条目（`"argus": "百眼巨人",`）还是写在注释行里（`//"vampire": "吸血鬼",`）——手工补的译文常常就写在注释行里，所以两种写法都认；
- 不想启用的条目，不要放进参照表（那样它会保持原样）；只有"覆盖译文"（`--ref-first`）的条目不改变启用状态，指导页补入的译文同样保持原状，避免把有意停用的条目重新启用。

补入译文的条目会同时从"未敲定翻译"统计里扣除，所以报告里的未敲定数量会随参照表变小。可以重复给出多份参照表（`--ref a.js --ref b.js`），同名标签以先给出的那份为准；仓库里的 `TagListAssist.js` 就是这样一份手工表，直接 `--ref TagListAssist.js` 即可。

### 2.3 推荐的两步流程

```powershell
# ① 先同步英文标签结构（结构以英文站为准）
node scrape-tag-list.mjs --merge TagList.js --out TagList.js

# ② 再回填中文译文（译名以中文指导页为准）
node fill-tag-translations.mjs --file TagList.js --out TagList.js

# ②b 可选：一并带入手工维护的译文（只补空，不改英文标签）
node fill-tag-translations.mjs --file TagList.js --out TagList.js --ref TagList.manual.js

# ③ 复核：报告 + 差异
git diff -- TagList.js
```

顺序反过来不会丢数据，只是第一次的报告里"有英文对应、但英文不在英文标签列表里的中文标签"会偏多（因为字典结构还是旧的）。

## 三、输出文件格式

```js
//updated to v195          ← 顶部注释：人工维护，脚本原样保留

const FullTagList =
{
    //Top Level              ← 分类注释
    "scp": "scp",
    "goi-format": "goi格式",
    //"more-by": "",        ← 被注释掉的条目：暂无译名或按约定不使用
    //
    //Major                  ← 分类之间用一行 // 分隔
    "001-proposal": "001提案",
    //
}
```

- 缩进 4 空格，条目行形如 `"english": "中文",`；
- 换行符默认 CRLF，文件结尾不留空行；
- 值为空字符串时该行必须保持注释状态（见"日常使用"里的提示）。

## 四、报告怎么看

回填脚本的统计写在 **stderr**（字典本体写 stdout 或 `--out`），分成若干段，段与段之间空一行：

| 提示 | 含义 |
| --- | --- |
| `条目 …｜指南候选 …（带英文名 …）` | 字典条目数，以及从三个指导页解析出的候选数 |
| `精确匹配 …｜同名直配 …｜下划线变体 …｜旧名搭桥 …｜特殊区块 …` | 五类匹配的数量 |
| `未匹配但有译文（保留原状）…｜未匹配且无译文（已注释）＝未敲定翻译 …` | 指导页没有覆盖的条目；后者会逐条列出，是待补译清单 |
| `【参照表】补入译文并启用 …` | 从 `--ref` 提供的对照表补进来的译文（这些条目同时被启用），逐条列成 `英文标签 - 中文`（用参照表时才有） |
| `【参照表】按 --ref-first …` | 参照表译文覆盖指导页译文的条目（只用 `--ref-first` 时才有） |
| `【参照表】参照表里的其它英文标签 …` | 参照表里有、本字典没有的英文标签，只计数并忽略，不会进入结果 |
| `【统计】一个中文对应多个英文` | 同一个中文标签在指导页里挂了多个英文标签（如 `建筑 → building / structure`） |
| `【统计】一个英文对应多个中文` | 同一个英文标签有多个中文译法；取值优先沿用文件现有译名，其余列出待确认 |
| `【统计】有英文对应、但英文不在英文标签列表里的中文标签` | 指导页写了个不在英文标签总表里的英文名，逐条列成 `中文 - 英文`；只报告，不写入文件 |
| `【校对】译文与现有不一致` | 指导页的写法与文件现有译文不同，默认采用指导页的（可用 `--prefer-existing` 反过来） |
| `【校对】指南内部不一致` | 同一中文标签在不同指导页挂了不同英文名，已按页面优先级取舍 |

以 2026-09-20 的页面、按推荐流程（先 `--merge` 沿用旧译文，再回填）为准，基准数字是：条目 988（启用 849、注释 139）｜指南候选 845（带英文名 788）｜精确匹配 757｜同名直配 3｜下划线变体 17｜旧名搭桥 5｜特殊区块 9｜未匹配但有译文 92｜未敲定翻译 105；统计三项分别为 2 / 3 / 16；校对两项分别为 8 / 1。**数字明显偏离时，先怀疑页面改版或抓取失败，再怀疑数据真的变了。**（如果跳过 `--merge` 直接用纯骨架，启用数会低得多——那说明旧译文没有被沿用，此时可以用 `--ref` 把手工表补回来。）

## 五、维护指南

### 5.1 开关都放在哪里

| 要改什么 | 改哪里 |
| --- | --- |
| 英文站的分类注释名、子分类归属 | `scrape-tag-list.mjs` 顶部的 `SECTION_MAP` |
| 抓哪些中文页面、取页面里的哪几节 | `fill-tag-translations.mjs` 顶部的 `SOURCES`（`sections.from/to` 按 `h1` 标题切段） |
| 哪些区块整段忽略 | `IGNORE_NOTES`（默认"不为英文维基使用""已经不为""已停用"） |
| 哪些区块只注释、仍参与匹配 | `SPECIAL_HEADINGS`（默认"工作人员专用"）、`SPECIAL_NOTES` |
| 带入手工维护的译文 | 运行时参数 `--ref <path>`（可重复），需要时再加 `--ref-first` |
| 报告里增删提示段 | `report()` 里的 `blocks` 数组，一段一个数组项；段间自动空一行 |
| 匹配优先级、变体/搭桥规则 | `matchEntries()`、`resolveCrossSource()` |

### 5.2 页面改版了怎么办

1. 先跑一次并把 HTML 存下来：`Invoke-WebRequest <url> -UseBasicParsing | Out-File -Encoding utf8 snapshot\xxx.html`；
2. 用 `--file` / `--dir` + `--offline` 复现问题；
3. 报告里出现"没解析出任何标签，页面结构可能变了"就是结构变了。**结构同步脚本**看正文是否还在 `#page-content` 的 tabview（`<div id="wiki-tab-…">`）里、标签定义是否仍是 `<li><strong><a href="…/page-tags/tag/…">`；**译文回填脚本**看标签条目是否仍是"中文标签（english-tag）"的写法、以及 `h1` 标题是否改名（改名就更新 `SOURCES` 的 `from/to`）；
4. 分类有增减时，先在 `SECTION_MAP` 里补一行再用快照验证。

### 5.3 每次同步的验收清单

```powershell
node --check TagList.js                      # 生成结果是合法 JS
node scrape-tag-list.mjs --merge TagList.js --out TagList.new.js
node fill-tag-translations.mjs --file TagList.new.js --offline --dir .\snapshot --out TagList.new.js
git diff --no-index TagList.js TagList.new.js
```

- 读一遍报告，确认新增 / 未敲定 / 校对三项都在预期内；
- 确认 `TagConv.js` 能正常翻译（用界面点一次，或直接用 Node 载入 `TagList.js` 查几个标签）；
- 两个脚本都是幂等的：对结果再跑一次，输出应与上一次逐行一致；
- `TagList.js` 的顶部注释不会被改，`//updated to vN` 需要自己决定是否递增。

### 5.4 常见问题

**PowerShell 里别用 `>` 重定向。** Windows PowerShell 5.1 的 `>` 写出的是 UTF-16LE，中文会乱码。始终使用 `--out`。

**抓取失败 / 断网。** 用 `--file`（结构）或 `--dir` + `--offline`（译文）读本地快照。快照建议提交进仓库或放进固定的 `snapshot` 目录，这样每次更新都能复现。

**某个标签的译名对不上。** 先看报告里的"有英文对应、但英文不在英文标签列表里的中文标签"和"指南内部不一致"两段：多半是英文站改过名（如 `cephalopodic → cephalopod`、`leporine → rabbit`）或指导页还写着旧名。工具已经能自动搭桥一部分，剩下的需要人工判断。

**想把某些标签排除掉。** 结构同步用 `--exclude a,b,c`；译文回填用 `--comment-all-unmatched`（未匹配的一律注释）或直接手工改 `TagList.js`（注释行会被后续脚本原样保留）。

**手工维护的译文怎么带进新版本。** 把那份对照表（旧版 `TagList.js` 的副本、或自建的表）用 `--ref TagList.manual.js` 指给译文回填脚本即可：默认只补空，加 `--ref-first` 则让手工值优先于指导页。补入译文的条目会自动启用（去掉 `//`），所以你手工写好的那些标签补进去就能直接用；不想启用的条目不要写进参照表。参照表只提供译文，**英文标签永远以 `TagList.js` 为准**——它不会新增、删除或移动任何条目，多出来的标签只在报告里计数。

**新增的分类注释名撞了。** 脚本会自动用父分类限定并在报告里说明；想固定成别的名字，就改 `SECTION_MAP` 里对应的 `subs` 值。

### 5.5 已知边界

- 两个脚本都用正则解析 HTML，不依赖 DOM 库。页面结构大改时需要按 5.2 检查，而不是指望脚本自动适应。
- 字典条目的值里不能出现转义引号（`\"`），现有数据没有这种写法。
- 指导页里的英文名可能过时或在英文站已废弃：前者由"旧名搭桥"处理，后者只在报告里列出，不会写进文件。
- 目录里的其它 `TagList*.js` 分两类：跑脚本产生的中间产物（例如不带 `--merge` 直接生成的纯骨架 `TagList1.js`）不属于正式链路，确认无用后可直接删除；手工维护的对照表（如 `TagListAssist.js`）建议保留，它正好可以当 `--ref` 的参照表。正式更新一律以 `TagList.js` 为准。
- 报告里"未敲定翻译"的条目（如 Staff Process 的部分隐藏标签 `_cc4`、`_licensebox`）在中文指导页里没有对应条目，需要人工补译。
