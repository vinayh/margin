import { useState } from "preact/hooks";

export interface InstallTab {
  label: string;
  url: string;
  storeName: string;
}

interface Props {
  tabs: InstallTab[];
}

export default function InstallTabs({ tabs }: Props) {
  const [active, setActive] = useState(0);
  const current = tabs[active];

  function selectFromKeyboard(event: KeyboardEvent, index: number): void {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") {
      next = (index - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    setActive(next);
    requestAnimationFrame(() =>
      document.getElementById(`install-tab-${next}`)?.focus()
    );
  }

  return (
    <div class="my-4 rounded-lg border border-rule overflow-hidden bg-cream-2">
      <div role="tablist" class="flex border-b border-rule text-[13px]">
        {tabs.map((t, i) => {
          const isActive = i === active;
          return (
            <button
              key={t.label}
              type="button"
              role="tab"
              id={`install-tab-${i}`}
              aria-controls="install-tab-panel"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActive(i)}
              onKeyDown={(event) => selectFromKeyboard(event, i)}
              class={"px-4 py-2 font-medium " +
                (isActive ? "bg-ink text-cream" : "hover:bg-ink/5")}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div
        id="install-tab-panel"
        role="tabpanel"
        aria-labelledby={`install-tab-${active}`}
        class="px-4 py-4 flex items-center justify-between gap-4"
      >
        <span class="text-[13px] text-ink-2">
          Margin for {current.label}, published on the {current.storeName}.
        </span>
        <a
          href={current.url}
          class="inline-flex items-center gap-2 rounded-md bg-ink text-cream px-3 py-1.5 text-[13px] font-medium hover:bg-ink-2 whitespace-nowrap"
        >
          Add to {current.label}
          <span aria-hidden="true">↗</span>
        </a>
      </div>
    </div>
  );
}
