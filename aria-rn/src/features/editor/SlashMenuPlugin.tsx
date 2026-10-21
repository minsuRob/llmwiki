import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { LexicalTypeaheadMenuPlugin, MenuOption, useBasicTypeaheadTriggerMatch } from "@lexical/react/LexicalTypeaheadMenuPlugin";
import type { TextNode } from "lexical";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { applyBlock, filterBlocks, type BlockDef } from "./blocks";

class BlockOption extends MenuOption {
  constructor(readonly def: BlockDef) {
    super(def.kind);
  }
}

/** "/" 로 여는 블록 메뉴 — 검색어로 거르고, 화살표 · Enter · 누르기로 고른다 */
export default function SlashMenuPlugin() {
  const [editor] = useLexicalComposerContext();
  const [query, setQuery] = useState<string | null>(null);
  const triggerFn = useBasicTypeaheadTriggerMatch("/", { minLength: 0, maxLength: 20, allowWhitespace: false });
  // 메뉴를 .lex-root 안에 붙여야 --lex-* 색 변수를 받는다(기본은 document.body)
  const [parent, setParent] = useState<HTMLElement | undefined>(undefined);
  useEffect(
    () =>
      editor.registerRootListener((root) => {
        setParent((root?.closest(".lex-root") as HTMLElement | null) ?? undefined);
      }),
    [editor],
  );
  const options = useMemo(() => filterBlocks(query ?? "").map((d) => new BlockOption(d)), [query]);

  const onSelectOption = (option: BlockOption, textNode: TextNode | null, closeMenu: () => void) => {
    editor.update(() => {
      // "/검색어" 글자는 지우고 블록만 바꾼다
      textNode?.remove();
    });
    applyBlock(editor, option.def.kind);
    closeMenu();
  };

  return (
    <LexicalTypeaheadMenuPlugin<BlockOption>
      onQueryChange={setQuery}
      onSelectOption={onSelectOption}
      triggerFn={triggerFn}
      options={options}
      parent={parent}
      menuRenderFn={(anchorRef, { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }) =>
        anchorRef.current
          ? createPortal(
              <div className="lex-slash" role="listbox" aria-label="블록 메뉴">
                {options.length === 0 ? <div className="lex-slash-empty">결과 없음</div> : <div className="lex-slash-title">기본 블록</div>}
                {options.map((option, i) => (
                  <div
                    key={option.key}
                    ref={(el) => option.setRefElement(el)}
                    role="option"
                    aria-selected={selectedIndex === i}
                    className={"lex-slash-item" + (selectedIndex === i ? " selected" : "")}
                    onMouseEnter={() => setHighlightedIndex(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectOptionAndCleanUp(option)}
                  >
                    <span className="lex-slash-glyph">{option.def.glyph}</span>
                    <span className="lex-slash-text">
                      <span className="lex-slash-label">{option.def.label}</span>
                      <span className="lex-slash-hint">{option.def.hint}</span>
                    </span>
                    {option.def.shortcut ? <span className="lex-slash-shortcut">{option.def.shortcut}</span> : null}
                  </div>
                ))}
              </div>,
              anchorRef.current,
            )
          : null
      }
    />
  );
}
