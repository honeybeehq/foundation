# Round 4 error analysis

Baseline: d854883, ids enabled. R2 optimistic and bilateral finite-scope strict scores are both retained in round4/before. Every unsupported candidate and missed label follows. These are scorer disagreements: duplicate evidence can be a real visible difference without being an independent cause. Tracks old labels are diagnostic only; the tables below use the new Flow View re-baseline.

## Classification method

Classify offscreen as scroll/sample or visibility; font-family as authored fallback vocabulary; geometry as wrapper/cascade consequence; structural findings as unmatched wrappers/content replacements. Misses use the hand label properties and inspected capture trees. The classification is diagnostic, not a new scoring oracle.

## inbox-row / failed

| Candidate | Cause class | Evidence |
|---|---|---|
| def-79f9f7d9a9771f3d590b | repeated style or evidence outside strict bilateral scope | font-size; {"code": "n249#0::n249::n17", "design": "n249#0::n249::n17"} |
| def-b919377e038fdadbfb42 | cascade / wrapper / sibling geometry consequence | height,position,box-sizing; {"code": "0/0/0", "design": "n249#0::n249::n18"} |
| def-e5b37030d619cb7b839c | cascade / wrapper / sibling geometry consequence | box-sizing; {"code": "n249#0::n249::n20", "design": "n249#0::n249::n20"} |
| def-a8d225dfe68a3986bc94 | cascade / wrapper / sibling geometry consequence | height,line-height,box-sizing; {"code": "n249#0::n249::n21", "design": "n249#0::n249::n21"} |
| def-eb11a06c57bfcb504b12 | property vocabulary: authored fallback stack / repeated inherited face | font-family; {"code": "n249#0::n249::n21", "design": "n249#0::n249::n21"} |
| def-a1eff6c6f2da917703ae | cascade / wrapper / sibling geometry consequence | y,box-sizing; {"code": "0/0/0/0/0/0", "design": "n249#0::n249::n19::n1"} |
| def-3c562f75dad54095a88b | cascade / wrapper / sibling geometry consequence | y,height,position,box-sizing; {"code": "0/0/1", "design": "n249#0::n249::n22"} |
| def-79e0a3cfddedf3721c2a | cascade / wrapper / sibling geometry consequence | y,box-sizing; {"code": "0/0/1/0", "design": "n249#0::n249::n23::n13"} |
| def-8a0f3c56a99b3de8528b | cascade / wrapper / sibling geometry consequence | y,height,line-height,box-sizing; {"code": "0/0/1/1", "design": "n249#0::n249::n24"} |
| def-385565412984144d1ced | property vocabulary: authored fallback stack / repeated inherited face | font-family; {"code": "0/0/1/1", "design": "n249#0::n249::n24"} |
| def-f4300db2cfbd7437a002 | wrapper or unmatched content replacement; sample list structure | node; {"design": "n249#0::n249::n25"} |
| def-6a903a4fcda7a02aa6b4 | wrapper or unmatched content replacement; sample list structure | node; {"code": "0"} |
| def-100d1a4a6a5d08034f99 | off-screen: duplicate clipped size consequence | offscreen; {"code": "n249#0::n249::n17"} |

| Missed cause | Cause class | Label evidence |
|---|---|---|
| IF-04 | uncertain/unmatched content pair | Note copy differs: "tmux host died mid-write — revive" in design vs "runtime died un-commanded — revive" in code (text) |
| IF-06 | uncaptured paint transform / icon vocabulary | Leading glyph sits 3px lower relative to the title (y 11 vs 8): code nudges marks down 2px to the title baseline on top of the taller line (transform) |

## help-center / agent-run

| Candidate | Cause class | Evidence |
|---|---|---|
| def-5e03bba5d8a08d49ab16 | cascade / wrapper / sibling geometry consequence | height,padding-bottom,row-gap,column-gap,justify-content,box-sizing,gap; {"code": "0/0/0/0", "design": "n46::n17"} |
| def-491f19982ae36afdd71c | property vocabulary: authored fallback stack / repeated inherited face | font-family; {"code": "0/0/0/0/0", "design": "n46::n18"} |
| def-5aae1955e337709eb6dd | cascade / wrapper / sibling geometry consequence | x,y,height,line-height,display,box-sizing; {"code": "0/0/0/0/1", "design": "n46::n20::n1"} |
| def-7cd58e1a36a0b3c5d91d | repeated style or evidence outside strict bilateral scope | color; {"code": "0/0/0/0/1", "design": "n46::n20::n1"} |
| def-1e5c72bc6fc68b591ade | duplicate shared surface style or independent border swallowed by surface group | border-top-color,border-right-color,border-bottom-color,border-left-color; {"code": "0/0/0/0/1", "design": "n46::n20::n1"} |
| def-6870cade95c7aebf6662 | property vocabulary: authored fallback stack / repeated inherited face | font-family; {"code": "0/0/0/0/1", "design": "n46::n20::n1"} |
| def-60a6145ecbac41c01105 | cascade / wrapper / sibling geometry consequence | x,y,width,height,padding-top,padding-right,padding-bottom,padding-left,line-height,box-sizing; {"code": "0/0/0/1", "design": "n46::n21::n10"} |
| def-d30ed7ff8b773a01995e | property vocabulary: authored fallback stack / repeated inherited face | font-family; {"code": "0/0/0/1", "design": "n46::n21::n10"} |
| def-99d6a32b3eaba5307d93 | cascade / wrapper / sibling geometry consequence | x,y,width,height,padding-top,padding-right,padding-bottom,padding-left,line-height,box-sizing; {"code": "0/0/0/6", "design": "n46::n23::n10"} |
| def-5994a182b003bd3fc012 | property vocabulary: authored fallback stack / repeated inherited face | font-family; {"code": "0/0/0/6", "design": "n46::n23::n10"} |
| def-e052f456b0a14fa376d9 | cascade / wrapper / sibling geometry consequence | x,width,box-sizing; {"code": "0/0/1", "design": "n47"} |
| def-4fbede4ab32a8fe2fabb | cascade / wrapper / sibling geometry consequence | y,box-sizing; {"code": "0/0/1/1", "design": "n53"} |
| def-681707d1c91560c4bee6 | property vocabulary: authored fallback stack / repeated inherited face | font-family; {"code": "0/0/1/1/0/7/3/0/0/0", "design": "n58#0::n58::n3"} |
| def-39b0e4417254b210826e | repeated style or evidence outside strict bilateral scope | white-space; {"code": "0/0/1/1/0/7/3/0/0/0", "design": "n58#0::n58::n3"} |
| def-061a29b1ece90ede7a09 | repeated style or evidence outside strict bilateral scope | color; {"code": "0/0/1/1/0/7/3/0/1/0/0", "design": "n58#0::n58::n7#0::n8::n1"} |
| def-5eec4d636e356f7fe9dc | duplicate shared surface style or independent border swallowed by surface group | border-top-color,border-right-color,border-bottom-color,border-left-color; {"code": "0/0/1/1/0/7/3/0/1/0/0", "design": "n58#0::n58::n7#0::n8::n1"} |
| def-1d026bf91679ca5ca1bd | property vocabulary: authored fallback stack / repeated inherited face | font-family; {"code": "0/0/1/1/0/7/3/0/1/0/0", "design": "n58#0::n58::n7#0::n8::n1"} |
| def-3d08f6896dd877b7d3ca | cascade / wrapper / sibling geometry consequence | line-height,box-sizing; {"code": "0/0/1/1/0/7/3/0/1/0/0", "design": "n58#0::n58::n7#0::n8::n1"} |
| def-44a37b4701eae57e24eb | cascade / wrapper / sibling geometry consequence | x,y,width,height,margin-left,box-sizing,flex-shrink; {"code": "0/0/1/1/0/7/20/0/1/3", "design": "n60#5::n60::n5"} |
| def-e2e95e8692acecc762a4 | cascade / wrapper / sibling geometry consequence | x,line-height,box-sizing; {"code": "0/0/1/1/0/7/20/0/1/3/1", "design": "n60#5::n60::n7#0::n8::n1"} |
| def-50fb1c565909c42a1a7d | repeated style or evidence outside strict bilateral scope | color; {"code": "0/0/1/1/0/7/20/0/1/3/1", "design": "n60#5::n60::n7#0::n8::n1"} |
| def-197f29af475feacd8d9e | duplicate shared surface style or independent border swallowed by surface group | border-top-color,border-right-color,border-bottom-color,border-left-color; {"code": "0/0/1/1/0/7/20/0/1/3/1", "design": "n60#5::n60::n7#0::n8::n1"} |
| def-b08dce355f4e614ba32b | property vocabulary: authored fallback stack / repeated inherited face | font-family; {"code": "0/0/1/1/0/7/20/0/1/3/1", "design": "n60#5::n60::n7#0::n8::n1"} |
| def-40b7d9141ea326fa262e | duplicate shared surface style or independent border swallowed by surface group | border-left-color; {"code": "0/0/1/1/1", "design": "n65"} |
| def-57dbd849b1ae95c7e8d9 | cascade / wrapper / sibling geometry consequence | row-gap,column-gap,box-sizing,gap,line-height; {"code": "0/0/1/2", "design": "n76"} |
| def-4af173dcd8d25a0df3ba | cascade / wrapper / sibling geometry consequence | x,y,height,box-sizing; {"code": "0/0/1/2/0", "design": "n83"} |
| def-d0bb5bf6391f7def2f62 | property vocabulary: authored fallback stack / repeated inherited face | font-family; {"code": "0/0/1/2", "design": "n76"} |
| def-5e857e8c90cced33cd6f | cascade / wrapper / sibling geometry consequence | x,y,height,margin-left,box-sizing; {"code": "0/0/1/2/1", "design": "n86"} |
| def-0d5659fdccd3e9a5fe0e | wrapper or unmatched content replacement; sample list structure | node; {"design": "n46::n21::n9"} |
| def-d649791eec5ce0f2115a | wrapper or unmatched content replacement; sample list structure | node; {"design": "n46::n22#0::n22::n12"} |
| def-c16da2ee6c11509bb564 | wrapper or unmatched content replacement; sample list structure | node; {"design": "n46::n22#1::n22::n12"} |
| def-376ca7effdd362a1f6b1 | wrapper or unmatched content replacement; sample list structure | node; {"design": "n46::n22#2::n22::n12"} |
| def-a29427e0dba09ce99dd2 | wrapper or unmatched content replacement; sample list structure | node; {"design": "n46::n22#3::n22::n12"} |
| def-80c82e2d6d3a6cd16d4d | wrapper or unmatched content replacement; sample list structure | node; {"design": "n46::n23::n9"} |
| def-00525de8235f62d336c0 | wrapper or unmatched content replacement; sample list structure | node; {"design": "n46::n24#0::n24::n12"} |
| def-f76c4f204742f3c3d694 | wrapper or unmatched content replacement; sample list structure | node; {"design": "n46::n24#1::n24::n12"} |
| def-af8ea9fd7d832e144af8 | wrapper or unmatched content replacement; sample list structure | node; {"design": "n46::n24#2::n24::n12"} |
| def-120e277cb049f861d0b2 | wrapper or unmatched content replacement; sample list structure | node; {"design": "n46::n27::n12"} |
| def-50105021b8fa4447e31a | wrapper or unmatched content replacement; sample list structure | node; {"design": "n48"} |
| def-e16936f2d58a8725b8ef | wrapper or unmatched content replacement; sample list structure | node; {"design": "n56::n9"} |
| def-9fd7e2f7cb581954965d | wrapper or unmatched content replacement; sample list structure | node; {"design": "n58#2::n58::n2"} |
| def-b166d412f87d9afccdca | wrapper or unmatched content replacement; sample list structure | node; {"design": "n58#3::n58::n2"} |
| def-7788b2acd23c2e876e00 | wrapper or unmatched content replacement; sample list structure | node; {"design": "n58#4::n58::n2"} |
| def-0dec34a7ed6e9b4d6885 | wrapper or unmatched content replacement; sample list structure | node; {"design": "n58#5::n58::n2"} |
| def-35daa3683f56028fa37e | wrapper or unmatched content replacement; sample list structure | node; {"design": "n58#6::n58::n2"} |
| def-f80d4d8ea2094fadbf7f | wrapper or unmatched content replacement; sample list structure | node; {"design": "n58#7::n58::n2"} |
| def-e3546363c569324ad668 | wrapper or unmatched content replacement; sample list structure | node; {"design": "n59::n9"} |
| def-b702f7fcaeb63cfd43e9 | wrapper or unmatched content replacement; sample list structure | node; {"design": "n60#0::n60::n2"} |
| def-03dc2aee52fea71964a6 | wrapper or unmatched content replacement; sample list structure | node; {"design": "n60#1::n60::n2"} |
| def-d98e87e17638a97423a5 | wrapper or unmatched content replacement; sample list structure | node; {"design": "n60#2::n60::n2"} |
| def-8d9859ed0ee315a1865e | wrapper or unmatched content replacement; sample list structure | node; {"design": "n60#3::n60::n2"} |
| def-316b2699f30ff1a05ae7 | wrapper or unmatched content replacement; sample list structure | node; {"design": "n60#4::n60::n2"} |
| def-2b2dca19f84413c01563 | wrapper or unmatched content replacement; sample list structure | node; {"design": "n60#5::n60::n3"} |
| def-c2fe599fd821aac908f0 | wrapper or unmatched content replacement; sample list structure | node; {"design": "n60#5::n60::n7#0::n7"} |
| def-50f58b985353fe1f695c | wrapper or unmatched content replacement; sample list structure | node; {"design": "n60#6::n60::n2"} |
| def-cdc9f77b6d5f4a227a53 | wrapper or unmatched content replacement; sample list structure | node; {"design": "n60#7::n60::n2"} |
| def-f5cd4920b224e08fcbe7 | wrapper or unmatched content replacement; sample list structure | node; {"design": "n60#8::n60::n2"} |
| def-14838cce905d13380a08 | wrapper or unmatched content replacement; sample list structure | node; {"design": "n60#9::n60::n2"} |
| def-362f79a0c6ebffc80741 | wrapper or unmatched content replacement; sample list structure | node; {"design": "n66::n15"} |
| def-fb25ee19190c0bdcf97d | wrapper or unmatched content replacement; sample list structure | node; {"design": "n67::n15"} |
| def-495a8cf9d9c232b82efc | wrapper or unmatched content replacement; sample list structure | node; {"design": "n68::n15"} |
| def-faed6181013a7faf0ef0 | wrapper or unmatched content replacement; sample list structure | node; {"design": "n69::n15"} |
| def-0573de4ca99414f6d9b9 | wrapper or unmatched content replacement; sample list structure | node; {"design": "n70::n15"} |
| def-52a755077f51fd8edf83 | wrapper or unmatched content replacement; sample list structure | node; {"design": "n71::n15"} |
| def-9794161919368fe913be | wrapper or unmatched content replacement; sample list structure | node; {"design": "n72::n15"} |
| def-096dc6c391492082f5e6 | wrapper or unmatched content replacement; sample list structure | node; {"design": "n73::n15"} |
| def-535d22e5dda1de003d4c | wrapper or unmatched content replacement; sample list structure | node; {"design": "n74::n15"} |
| def-1d9d280c32d7cf666d39 | wrapper or unmatched content replacement; sample list structure | node; {"design": "n75::n15"} |
| def-c59d45bb5e718b6dfd73 | wrapper or unmatched content replacement; sample list structure | node; {"design": "n78"} |
| def-e56ae81c7ddb9bdf8b3f | wrapper or unmatched content replacement; sample list structure | node; {"design": "n79"} |
| def-07c79889ae2213176ffd | wrapper or unmatched content replacement; sample list structure | node; {"design": "n80"} |
| def-92670a20e304c9933f90 | wrapper or unmatched content replacement; sample list structure | node; {"design": "n81"} |
| def-b284f4d800ad4c78ccdd | wrapper or unmatched content replacement; sample list structure | node; {"design": "n82"} |
| def-27c69ee86436cb0303e9 | wrapper or unmatched content replacement; sample list structure | node; {"design": "n84"} |
| def-fd0f0dedfcfa13f39bba | wrapper or unmatched content replacement; sample list structure | node; {"design": "n85"} |
| def-6a903a4fcda7a02aa6b4 | wrapper or unmatched content replacement; sample list structure | node; {"code": "0"} |
| def-130e3350d006032973f1 | off-screen: scroll/sample boundary | offscreen; {"code": "0/0/1/1/0/0"} |
| def-2c25dcfab3cee1c5fc4e | off-screen: scroll/sample boundary | offscreen; {"code": "0/0/1/1/0/1"} |
| def-7e2ae6980fd6f77749fa | off-screen: scroll/sample boundary | offscreen; {"code": "0/0/1/1/0/2"} |
| def-7795bab6bcc65b3ddd74 | off-screen: scroll/sample boundary | offscreen; {"code": "0/0/1/1/0/3"} |
| def-bd3082112deedd720634 | off-screen: scroll/sample boundary | offscreen; {"code": "0/0/1/1/0/4"} |
| def-3659c1ddfc8a9aca0637 | off-screen: scroll/sample boundary | offscreen; {"code": "0/0/1/1/0/5"} |
| def-8a24cceaff3a7458e5a1 | off-screen: scroll/sample boundary | offscreen; {"code": "0/0/1/1/0/6"} |
| def-b39fc957765c66be7d56 | off-screen: scroll/sample boundary | offscreen; {"code": "0/0/1/1/0/7/20"} |
| def-d2d7ec9ebe4fb1d34c9d | off-screen: scroll/sample boundary | offscreen; {"code": "0/0/1/1/0/7/21"} |
| def-aa9e1801730e279822fa | off-screen: scroll/sample boundary | offscreen; {"code": "0/0/1/1/0/7/22"} |
| def-38bc74648a3284cdf26d | off-screen: scroll/sample boundary | offscreen; {"code": "0/0/1/1/0/7/23"} |
| def-e24e57ef6cb8509d6e4a | off-screen: scroll/sample boundary | offscreen; {"code": "0/0/1/1/0/7/24"} |
| def-1f282236a17f55bf87f3 | off-screen: scroll/sample boundary | offscreen; {"code": "0/0/1/1/0/7/25"} |
| def-436cae31c419f60343aa | off-screen: scroll/sample boundary | offscreen; {"code": "0/0/1/1/0/7/26"} |
| def-d570bac37202409bee22 | off-screen: scroll/sample boundary | offscreen; {"code": "0/0/1/1/0/7/27"} |
| def-01f987e5bb5638a22d5f | off-screen: scroll/sample boundary | offscreen; {"code": "0/0/1/1/0/7/28"} |
| def-1ae8cbbd702f58c533cd | off-screen: scroll/sample boundary | offscreen; {"code": "0/0/1/1/0/7/29"} |
| def-ef9680f077896ae054a3 | off-screen: scroll/sample boundary | offscreen; {"code": "0/0/1/1/0/7/30"} |
| def-98862b91a981d92942ab | off-screen: scroll/sample boundary | offscreen; {"code": "0/0/1/1/0/7/31"} |
| def-37328155b6d334a9d684 | off-screen: scroll/sample boundary | offscreen; {"code": "0/0/1/1/0/7/32"} |
| def-fd6fd4c0b89dddf58a51 | off-screen: scroll/sample boundary | offscreen; {"code": "0/0/1/1/0/7/33"} |
| def-0d52553601129adca4bb | off-screen: scroll/sample boundary | offscreen; {"code": "0/0/1/1/0/7/34"} |
| def-27a0ceb4111a9a8f589c | off-screen: scroll/sample boundary | offscreen; {"code": "0/0/1/1/0/7/35"} |
| def-fa94a4fc0f8fdf34bad4 | off-screen: scroll/sample boundary | offscreen; {"code": "0/0/1/1/0/7/36"} |
| def-8f1491ede53f50f4151d | off-screen: scroll/sample boundary | offscreen; {"code": "0/0/1/1/0/7/37"} |
| def-6f6bd2cec19c699da9b8 | off-screen: scroll/sample boundary | offscreen; {"code": "0/0/1/1/0/7/38"} |
| def-5c1e3252deda91d39e86 | off-screen: scroll/sample boundary | offscreen; {"code": "0/0/1/1/0/7/39"} |
| def-f866050b3acc5f95bd4f | off-screen: scroll/sample boundary | offscreen; {"code": "0/0/1/1/0/7/40"} |
| def-e7d42247c1a539e48f3a | off-screen: scroll/sample boundary | offscreen; {"code": "0/0/1/1/0/7/41"} |
| def-14d292ccc4a7f2a782b7 | off-screen: scroll/sample boundary | offscreen; {"code": "0/0/1/1/0/7/42"} |
| def-37e79d8a833849a032b5 | off-screen: scroll/sample boundary | offscreen; {"code": "0/0/1/1/0/7/43"} |
| def-7ed9c276520e8194847f | off-screen: scroll/sample boundary | offscreen; {"code": "0/0/1/1/0/8"} |
| def-2c4d072e9eec67e48ff5 | off-screen: scroll/sample boundary | offscreen; {"code": "0/0/1/1/0/9"} |
| def-454592394d6db8c80548 | off-screen: scroll/sample boundary | offscreen; {"code": "0/0/1/1/0/10"} |
| def-4207759e0ab3c2bb1a02 | off-screen: scroll/sample boundary | offscreen; {"code": "0/0/1/1/0/11"} |
| def-b2e85ce68233473f30b9 | off-screen: scroll/sample boundary | offscreen; {"code": "0/0/1/1/0/12"} |
| def-3ad0fdb5ae3c27d9e4b0 | off-screen: scroll/sample boundary | offscreen; {"code": "0/0/1/1/0/13"} |

| Missed cause | Cause class | Label evidence |
|---|---|---|
| H-02 | uncertain/unmatched content pair | Shortcut rows come from the live command registry: Agent run has about 40 rows (Where this runs, Session actions, Focus composer input, Model effort and speed …) instead of the design's 8 samples; Surface a card and Archive agent are not there, Toggle important / Copy bee id / self-seal are far below, notes are reworded ("running bee: queued, delivered at turn end"), and GLOBAL lacks Jump to pane, Jump to most important, Needs me (text) |
| H-03 | uncertain/unmatched content pair | Command names are cut off with an ellipsis when the note is long ("Where this …", "Session actio…", "Queue until the current turn e…", "Work…", "Scroll transcript down / up half a …"); in the design the name always shows in full and only the note gives way (flex-shrink;text-overflow;width) |
| H-04 | uncertain/unmatched content pair | Section header reads "THIS PANE · AGENT RUN" followed by a mono "· opened from drone-07" in design; code shows "AGENT RUN" with a small grey "THIS PANE" pill and no "opened from" origin (text;background-color;font-size;layout) |
| H-07 | uncertain/unmatched content pair | Guide topic "Yards & quests" reads "Yards & products" in code (text) |
| H-12 | uncertain/unmatched content pair | Count reads "183 shortcuts · 14 surfaces" instead of "86 bindings · 10 surfaces" (text) |
| H-13 | uncertain/unmatched content pair | Anchor rail lists the code's 14 surfaces: adds Browser, Terminal, Whiteboard, Tracks, Agent run, Inbox, Sheet; has no This pane, Changes or Sidebar & pickers; Editor is "Files & editor" (text) |
| H-14 | broad scope / region grouping / property vocabulary | Active anchor styling differs: design highlights "This pane" in primary ink #2E2B27 (600) with "Global" in #6F6B63; code highlights "Agent run" in #6F6B63 (600) and "Global" is faint like the rest (color;font-weight) |
| H-18 | broad scope / region grouping / property vocabulary | Key-cap label ink is lighter in code: #6B6862 (inkSoft) vs #5A564E (color) |
| H-19 | broad scope / region grouping / property vocabulary | Key caps use border #E2E0DB (ghostBorder) instead of --color-border #E7E5E0 (border-color) |
| H-21 | broad scope / region grouping / property vocabulary | The focused search field has a darker border in code (#DAD5CC) than the dialog design shows for it (--color-border #E7E5E0, while the design already paints a caret, i.e. focused) (border-color) |

## tracks-flowview / empty

| Candidate | Cause class | Evidence |
|---|---|---|
| def-aea252968eb4f8660e79 | repeated style or evidence outside strict bilateral scope | text; {"code": "n284::n276::n40", "design": "n284::n276::n40"} |
| def-20a00fc76f833d7c3c13 | cascade / wrapper / sibling geometry consequence | margin-top; {"code": "n284::n276::n40", "design": "n284::n276::n40"} |
| def-f6c59c6c33ffdbe50848 | cascade / wrapper / sibling geometry consequence | flex-shrink; {"code": "0/0/0/0/0/2/0", "design": "n284::n605::n412"} |
| def-f861dffbdb49e3785b6f | cascade / wrapper / sibling geometry consequence | position; {"code": "0/0/0/1/0/0/0", "design": "n284::n272::n470"} |
| def-fbaf1582d3354bf0482e | cascade / wrapper / sibling geometry consequence | display,flex-shrink; {"code": "0/0/0/2/0/0", "design": "n284::n609::n540::n412"} |
| def-7f8b7f1a0d74dac3b82f | wrapper or unmatched content replacement; sample list structure | node; {"design": "n284::n276::n41"} |
| def-3d53a609c46642f8b814 | wrapper or unmatched content replacement; sample list structure | node; {"design": "n284::n609::n539"} |

| Missed cause | Cause class | Label evidence |
|---|---|---|

## tracks-flowview / track-selected

| Candidate | Cause class | Evidence |
|---|---|---|
| def-72ff9022e8b33a2ac3df | cascade / wrapper / sibling geometry consequence | flex-shrink; {"code": "0/0/0/0/0/2/0", "design": "n212::n578::n412"} |
| def-cc41dd2623c1d27a3c95 | cascade / wrapper / sibling geometry consequence | flex-shrink; {"code": "0/0/0/0/1/0/0/0", "design": "n212::n579#0::n579::n530::n412"} |
| def-672e70f3df48d92593aa | cascade / wrapper / sibling geometry consequence | flex-shrink; {"code": "0/0/0/0/1/1/0/0", "design": "n212::n579#1::n579::n530::n412"} |
| def-22b4f63deb41cd9d8278 | cascade / wrapper / sibling geometry consequence | flex-shrink; {"code": "0/0/0/0/1/2/0/0", "design": "n212::n579#2::n579::n530::n412"} |
| def-506da30dd3a203d2ade9 | cascade / wrapper / sibling geometry consequence | flex-shrink; {"code": "0/0/0/0/1/3/0/0", "design": "n212::n579#3::n579::n530::n412"} |
| def-11b9f7e2ce8d466dee3e | cascade / wrapper / sibling geometry consequence | flex-shrink; {"code": "0/0/0/0/1/4/0/0", "design": "n212::n579#4::n579::n530::n412"} |
| def-2337fb04f513945d96da | cascade / wrapper / sibling geometry consequence | flex-shrink; {"code": "0/0/0/0/1/5/0/0", "design": "n212::n579#5::n579::n530::n412"} |
| def-b7747de334d0e721bf1c | cascade / wrapper / sibling geometry consequence | flex-shrink; {"code": "0/0/0/0/1/6/0/0", "design": "n212::n579#6::n579::n530::n412"} |
| def-1ab95bad8f323f28e8f7 | cascade / wrapper / sibling geometry consequence | flex-shrink; {"code": "0/0/0/1/0/1/0", "design": "n212::n581::n25"} |
| def-17b6211d0c0dbd9536ee | cascade / wrapper / sibling geometry consequence | x,width,row-gap,column-gap,display,align-items,gap; {"code": "0/0/0/1/0/1", "design": "n212::n582"} |
| def-6b4788eb59ce6e701999 | repeated style or evidence outside strict bilateral scope | text; {"code": "0/0/0/1/0/4", "design": "n212::n588::n37"} |
| def-a0d2149f30b77d6648ea | cascade / wrapper / sibling geometry consequence | row-gap,column-gap,gap; {"code": "0/0/0/1/0/4", "design": "n212::n588::n37"} |
| def-386c34bdbc73caa31d1e | cascade / wrapper / sibling geometry consequence | display,flex-direction,position,overflow-x,overflow-y,flex-grow; {"code": "0/0/0/1/1/0", "design": "n212::n590::n436"} |
| def-e8d82f7dd9e3927f21f4 | cascade / wrapper / sibling geometry consequence | height; {"code": "0/0/0/1/1/0/0/0", "design": "n212::n590::n438"} |
| def-bfb0800ce06d7890a8fa | cascade / wrapper / sibling geometry consequence | flex-shrink; {"code": "0/0/0/1/1/0/0/0/1/0", "design": "n212::n590::n440"} |
| def-a31660b0d40da6f30898 | cascade / wrapper / sibling geometry consequence | x,width,margin-bottom,row-gap,column-gap,display,align-items,gap; {"code": "0/0/0/1/1/0/0/0/1", "design": "n212::n590::n441"} |
| def-23061b8f40f6e23c8fa1 | cascade / wrapper / sibling geometry consequence | margin-top,margin-bottom; {"code": "0/0/0/1/1/0/0/0/6/0", "design": "n212::n590::n449"} |
| def-270a8a0cb5eeecc39105 | cascade / wrapper / sibling geometry consequence | x,y,width,height,padding-top,padding-left,position,flex-shrink; {"code": "0/0/0/1/1/0/0/0/9/0/0", "design": "n212::n590::n459::n402"} |
| def-98a1196782cd0c483d62 | cascade / wrapper / sibling geometry consequence | y; {"code": "0/0/0/1/1/0/0/0/0/1", "design": "n212::n590::n459::n401"} |
| def-00a3f44e7ac0af8a9ee1 | cascade / wrapper / sibling geometry consequence | height,padding-top,overflow-x,overflow-y,flex-shrink; {"code": "0/0/0/1/1/0/0/0/0/1/0", "design": "n212::n590::n459::n403"} |
| def-af62a4941c15f7eea8c5 | cascade / wrapper / sibling geometry consequence | flex-shrink; {"code": "0/0/0/1/2/1/0", "design": "n212::n595::n25"} |
| def-1005d9889c749d164145 | cascade / wrapper / sibling geometry consequence | x,width,margin-left,row-gap,column-gap,display,align-items,gap; {"code": "0/0/0/1/2/1", "design": "n212::n596"} |
| def-578020df6c9a17846ad2 | cascade / wrapper / sibling geometry consequence | display,flex-shrink; {"code": "0/0/0/2/0/0", "design": "n212::n598::n540::n412"} |
| def-c85311fec7c7f7a210fd | wrapper or unmatched content replacement; sample list structure | node; {"design": "n212::n580"} |
| def-151eeeb33caa45ed79d6 | wrapper or unmatched content replacement; sample list structure | node; {"design": "n212::n588::n38"} |
| def-f66d66738f8e6db19490 | wrapper or unmatched content replacement; sample list structure | node; {"design": "n212::n590::n437"} |
| def-762890ec3deb3a83c549 | wrapper or unmatched content replacement; sample list structure | node; {"design": "n212::n594"} |
| def-b11b021c80de5305e1af | wrapper or unmatched content replacement; sample list structure | node; {"design": "n212::n598::n539"} |
| def-fab48bd4925e9d08d849 | wrapper or unmatched content replacement; sample list structure | node; {"code": "0/0/0/1/1/0/0/0/0/0"} |

| Missed cause | Cause class | Label evidence |
|---|---|---|
| TS-01 | broad scope / region grouping / property vocabulary | The canvas dot grid is offset by about 10px horizontally and 2–3px vertically in code (dots are painted on the inner flow surface, not the canvas), so dots land in different places and touch some labels such as "approved ↓ continues" (background-image;background-position) |
| TS-02 | broad scope / region grouping / property vocabulary | Below the visible area (seen after scrolling): after the Verdict gate branch rejoins, code adds an extra ~42px connector, so Publish preview and everything after it sits 41–42px lower than in the design (padding;top) |
| TS-03 | broad scope / region grouping / property vocabulary | Below the visible area: the Ship it? card is 269px wide in code vs 248px, and its title stretches so "upcoming · blocking ask" is pushed to the card's right edge instead of following the title (width;flex-grow) |

## inbox-row / selected

| Candidate | Cause class | Evidence |
|---|---|---|
| def-0d85d6c9ad35cad59852 | repeated style or evidence outside strict bilateral scope | font-size; {"code": "n249#1::n249::n17", "design": "n249#1::n249::n17"} |
| def-d433c9d27b5d3072d9ff | cascade / wrapper / sibling geometry consequence | height,position,box-sizing; {"code": "0/0/0", "design": "n249#1::n249::n18"} |
| def-8e8917dd461699b30490 | cascade / wrapper / sibling geometry consequence | box-sizing; {"code": "n249#1::n249::n20", "design": "n249#1::n249::n20"} |
| def-78029c6a49e350688e69 | cascade / wrapper / sibling geometry consequence | height,line-height,box-sizing; {"code": "n249#1::n249::n21", "design": "n249#1::n249::n21"} |
| def-f93a35636ddb25edf0a9 | property vocabulary: authored fallback stack / repeated inherited face | font-family; {"code": "n249#1::n249::n21", "design": "n249#1::n249::n21"} |
| def-2712ef31fdf1ce36c7f3 | cascade / wrapper / sibling geometry consequence | y,height,position,box-sizing; {"code": "0/0/1", "design": "n249#1::n249::n22"} |
| def-ee4f281dbd96555e9914 | cascade / wrapper / sibling geometry consequence | x,width,line-height,box-sizing; {"code": "0/0/1/0", "design": "n249#1::n249::n25"} |
| def-fbb009cded2a4adf3a28 | wrapper or unmatched content replacement; sample list structure | node; {"design": "n249#1::n249::n19::n1"} |
| def-5a56a212a6862218a6aa | wrapper or unmatched content replacement; sample list structure | node; {"design": "n249#1::n249::n24"} |
| def-6a903a4fcda7a02aa6b4 | wrapper or unmatched content replacement; sample list structure | node; {"code": "0"} |
| def-ec77268722c9314861fb | off-screen: duplicate clipped size consequence | offscreen; {"code": "n249#1::n249::n17"} |

| Missed cause | Cause class | Label evidence |
|---|---|---|
| IS-03 | uncaptured paint transform / icon vocabulary | Leading glyph is the row-kind icon (window/card) in muted #8A877F in design; code always shows the agent's model logo (OpenAI mark) in lighter #A29D93 (icon;color) |
| IS-07 | uncaptured paint transform / icon vocabulary | Leading glyph sits 3px lower relative to the title (y 11 vs 8): code nudges marks down 2px to the title baseline on top of the taller line (transform) |

## keycap / default

| Candidate | Cause class | Evidence |
|---|---|---|
| def-f9d3f7a1a2de447ef05b | property vocabulary: authored fallback stack / repeated inherited face | font-family; {"code": "n203::n1", "design": "n203::n1"} |

| Missed cause | Cause class | Label evidence |
|---|---|---|

## tracks-flowview / proposal-pending

| Candidate | Cause class | Evidence |
|---|---|---|
| def-72ff9022e8b33a2ac3df | cascade / wrapper / sibling geometry consequence | flex-shrink; {"code": "0/0/0/0/0/2/0", "design": "n212::n578::n412"} |
| def-cc41dd2623c1d27a3c95 | cascade / wrapper / sibling geometry consequence | flex-shrink; {"code": "0/0/0/0/1/0/0/0", "design": "n212::n579#0::n579::n530::n412"} |
| def-672e70f3df48d92593aa | cascade / wrapper / sibling geometry consequence | flex-shrink; {"code": "0/0/0/0/1/1/0/0", "design": "n212::n579#1::n579::n530::n412"} |
| def-22b4f63deb41cd9d8278 | cascade / wrapper / sibling geometry consequence | flex-shrink; {"code": "0/0/0/0/1/2/0/0", "design": "n212::n579#2::n579::n530::n412"} |
| def-506da30dd3a203d2ade9 | cascade / wrapper / sibling geometry consequence | flex-shrink; {"code": "0/0/0/0/1/3/0/0", "design": "n212::n579#3::n579::n530::n412"} |
| def-11b9f7e2ce8d466dee3e | cascade / wrapper / sibling geometry consequence | flex-shrink; {"code": "0/0/0/0/1/4/0/0", "design": "n212::n579#4::n579::n530::n412"} |
| def-2337fb04f513945d96da | cascade / wrapper / sibling geometry consequence | flex-shrink; {"code": "0/0/0/0/1/5/0/0", "design": "n212::n579#5::n579::n530::n412"} |
| def-b7747de334d0e721bf1c | cascade / wrapper / sibling geometry consequence | flex-shrink; {"code": "0/0/0/0/1/6/0/0", "design": "n212::n579#6::n579::n530::n412"} |
| def-9219b2aed91b6e50772e | repeated style or evidence outside strict bilateral scope | text; {"code": "0/0/0/1/0/1", "design": "n212::n583"} |
| def-f789bfaa76f0848f3a9f | cascade / wrapper / sibling geometry consequence | flex-shrink; {"code": "0/0/0/1/0/1/0", "design": "n212::n584::n25"} |
| def-1b557a4dc4adbc6734bf | repeated style or evidence outside strict bilateral scope | text; {"code": "0/0/0/1/0/4", "design": "n212::n589::n37"} |
| def-7d070b620beaed1a99e5 | cascade / wrapper / sibling geometry consequence | row-gap,column-gap,gap; {"code": "0/0/0/1/0/4", "design": "n212::n589::n37"} |
| def-86132b284054b9424221 | cascade / wrapper / sibling geometry consequence | height,display,align-items,flex-direction,position,flex-grow; {"code": "0/0/0/1/1/0", "design": "n212::n591::n482"} |
| def-cd9e18900ba151e5f9b5 | duplicate shared surface style or independent border swallowed by surface group | background-image; {"code": "0/0/0/1/1/0", "design": "n212::n591::n482"} |
| def-51eb6c3d1403d757cf13 | cascade / wrapper / sibling geometry consequence | height; {"code": "0/0/0/1/1/0/0/0", "design": "n212::n591::n483"} |
| def-4ef0a287362c41f5b7e2 | cascade / wrapper / sibling geometry consequence | width; {"code": "0/0/0/1/1/0/0/0/1/1", "design": "n212::n591::n484::n410"} |
| def-8ab77b382246639cb0c5 | cascade / wrapper / sibling geometry consequence | margin-top,margin-bottom; {"code": "0/0/0/1/1/0/0/0/5/0", "design": "n212::n591::n491"} |
| def-6ef04412b540655293c4 | cascade / wrapper / sibling geometry consequence | width; {"code": "0/0/0/1/1/0/0/0/5/0/0/0/1", "design": "n212::n591::n494::n410"} |
| def-f0d751735bad3f0fd238 | cascade / wrapper / sibling geometry consequence | width; {"code": "0/0/0/1/1/0/0/0/5/0/1/0/1", "design": "n212::n591::n497::n410"} |
| def-46ad1d9458544412d8bf | cascade / wrapper / sibling geometry consequence | x,y,width,height,padding-top,padding-left,position,flex-shrink; {"code": "0/0/0/1/1/0/0/0/8/0/0", "design": "n212::n591::n501::n402"} |
| def-16c33c1bc3577154c1f8 | cascade / wrapper / sibling geometry consequence | y; {"code": "0/0/0/1/1/0/0/0/0/1", "design": "n212::n591::n501::n401"} |
| def-35eded7d23ee335656d9 | cascade / wrapper / sibling geometry consequence | height,padding-top,overflow-x,overflow-y,flex-shrink; {"code": "0/0/0/1/1/0/0/0/0/1/0", "design": "n212::n591::n501::n403"} |
| def-578020df6c9a17846ad2 | cascade / wrapper / sibling geometry consequence | display,flex-shrink; {"code": "0/0/0/2/0/0", "design": "n212::n598::n540::n412"} |
| def-b40ca41ad61524496675 | cascade / wrapper / sibling geometry consequence | margin-top,margin-right,position,flex-shrink; {"code": "0/0/0/2/0/1", "design": "n212::n598::n541"} |
| def-0c437d71f57291a1939e | wrapper or unmatched content replacement; sample list structure | node; {"design": "n212::n585"} |
| def-23fbfc4bdb594adf74e1 | wrapper or unmatched content replacement; sample list structure | node; {"design": "n212::n589::n38"} |
| def-aedf5edbb2d446a93a6b | wrapper or unmatched content replacement; sample list structure | node; {"design": "n212::n591::n481"} |
| def-b11b021c80de5305e1af | wrapper or unmatched content replacement; sample list structure | node; {"design": "n212::n598::n539"} |
| def-fab48bd4925e9d08d849 | wrapper or unmatched content replacement; sample list structure | node; {"code": "0/0/0/1/1/0/0/0/0/0"} |
| def-ea0ff0398b3a4cab4745 | wrapper or unmatched content replacement; sample list structure | node; {"code": "0/0/0/1/1/0/0/0/8/1"} |
| def-42918d8b51867ca74161 | off-screen: duplicate clipped size consequence | offscreen; {"code": "0/0/0/1/1/0/0/0/12/0/1"} |
| def-e81abb7544730cf24bab | off-screen: duplicate clipped size consequence | offscreen; {"code": "0/0/0/1/1/0/0/0/12/2/0"} |
| def-bac7604b13117b786a5c | off-screen: duplicate clipped size consequence | offscreen; {"code": "0/0/0/1/1/0/0/0/14/0/1"} |
| def-ea9d48cb194eb28e0596 | off-screen: duplicate clipped size consequence | offscreen; {"code": "0/0/0/1/1/0/0/0/14/2/0"} |
| def-d0719c877112c3fa76e1 | off-screen: duplicate clipped size consequence | offscreen; {"code": "0/0/0/1/1/0/0/0/17"} |

| Missed cause | Cause class | Label evidence |
|---|---|---|
| PP-01 | broad scope / region grouping / property vocabulary | The proposal's Accept / Refine / Discard bar floats at the bottom of the visible canvas in the design (y≈528); in code it sits after the last step at y≈1106, about 580px down, so it is off screen until you scroll to the end and the visible spot shows the Fix findings card instead (top;position) |
| PP-02 | broad scope / region grouping / property vocabulary | Below the visible area (seen after scrolling): after the Verdict gate branch rejoins, code adds an extra ~42px connector, so Publish preview and everything after it sits 41–42px lower than in the design (padding;top) |
| PP-03 | broad scope / region grouping / property vocabulary | The canvas dot grid is offset by about 10px horizontally and 2–3px vertically in code (dots are painted on the inner flow surface, not the canvas), so dots land in different places and touch some labels such as "approved ↓ continues" (background-image;background-position) |

## Tracks diagnostic boundary

The old Tracks labels were authored for the pre-Flow View design and cannot establish round-4 precision or recall. The prior diagnostic report identifies independent graph/style causes hidden by region merging, row metadata swallowed by uncertain pairs, and the proposal bar outside the pane. Preserve detection of that bar while removing scrollable sample-list alarms. Updated Tracks tables above use the re-baseline supplied by L2 at 890e056.

## Fix order

1. Keep rendered font-stack equivalence separate from authored fallback spelling; avoid box-sizing findings without visible box effects.
2. Recover local text/icon replacements using enclosing correspondence, and compare captured paint facts.
3. Collapse repeated style-value causes without swallowing independent properties into a region.
4. Use scroll reachability for new list samples; retain visible design counterparts displaced out of view.
5. Keep all changes generic and preserve raw evidence and uncertainty.
