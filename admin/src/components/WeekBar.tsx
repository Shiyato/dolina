import { useCallback, useEffect, useRef } from "react";
import type { WeekInfo } from "../services/api";

/**
 * Барабан выбора недели (как wheel-селектор). Захватываешь ленту и тянешь —
 * элементы едут за курсором/пальцем; при отпускании ближайшая неделя С ДАННЫМИ
 * встаёт в центр и выбирается. Клик по неделе тоже центрирует её.
 * Недели без данных и будущие показаны серыми, но не выбираются.
 */
/** Сдвиг в пикселях, начиная с которого жест считается перетаскиванием. */
const DRAG_THRESHOLD = 8;

export default function WeekBar({
  weeks,
  selected,
  onSelect,
}: {
  weeks: WeekInfo[];
  selected: string;
  onSelect: (weekStart: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef({ active: false, startX: 0, startScroll: 0, moved: false });

  const selectable = (w: WeekInfo) => (w.hasData || w.isCurrent) && !w.isFuture;

  /** Неделя с данными, ближайшая к центру контейнера. */
  const centeredWeek = useCallback((): string | null => {
    const box = ref.current;
    if (!box) return null;
    const mid = box.scrollLeft + box.clientWidth / 2;
    let best: string | null = null;
    let bestDist = Infinity;
    box.querySelectorAll<HTMLElement>('[data-selectable="1"]').forEach((el) => {
      const c = el.offsetLeft + el.offsetWidth / 2;
      const dist = Math.abs(c - mid);
      if (dist < bestDist) {
        bestDist = dist;
        best = el.dataset.week ?? null;
      }
    });
    return best;
  }, []);

  const scrollToWeek = useCallback((weekStart: string, smooth = true) => {
    const box = ref.current;
    const el = box?.querySelector<HTMLElement>(`[data-week="${weekStart}"]`);
    if (!box || !el) return;
    const target = el.offsetLeft + el.offsetWidth / 2 - box.clientWidth / 2;
    box.scrollTo({ left: target, behavior: smooth ? "smooth" : "auto" });
  }, []);

  // Центрировать выбранную неделю при внешнем изменении selected.
  useEffect(() => {
    if (selected) scrollToWeek(selected, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  // ── Перетаскивание (pointer drag) ──────────────────────────────
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = ref.current;
    if (!box) return;
    // Захват НЕ ставим здесь: при активном pointer capture Chrome перенаправляет
    // на контейнер и click, и тогда onClick кнопки недели не срабатывает вовсе.
    // Захватываем только когда палец/курсор реально поехал (см. onPointerMove).
    drag.current = {
      active: true,
      startX: e.clientX,
      startScroll: box.scrollLeft,
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = ref.current;
    if (!box || !drag.current.active) return;
    const dx = e.clientX - drag.current.startX;
    // Порог с запасом: клик мышью и тап пальцем почти всегда дают микросдвиг,
    // и при слишком чутком пороге они бы считались перетаскиванием.
    if (!drag.current.moved && Math.abs(dx) > DRAG_THRESHOLD) {
      drag.current.moved = true;
      // Теперь это точно перетаскивание — берём захват, чтобы лента ехала за
      // курсором даже когда он вышел за пределы селектора.
      try {
        box.setPointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
    }
    if (!drag.current.moved) return;
    box.scrollLeft = drag.current.startScroll - dx;
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = ref.current;
    if (!box || !drag.current.active) return;
    drag.current.active = false;
    if (box.hasPointerCapture(e.pointerId)) {
      try {
        box.releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
    }
    // Доводим до центра только после настоящего перетаскивания. Иначе это был
    // клик/тап по конкретной неделе — его обработает onClick кнопки, а снап
    // отсюда перебил бы выбор соседней неделей, оказавшейся в центре.
    if (!drag.current.moved) return;
    const ws = centeredWeek();
    if (ws) {
      scrollToWeek(ws);
      if (ws !== selected) onSelect(ws);
    }
  };

  return (
    <div className="relative -mx-[24px]">
      {/* Метка центра */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center">
        <div className="mt-[2px] h-[6px] w-[6px] rounded-full bg-[var(--color-accent)]/40" />
      </div>

      <div
        ref={ref}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="no-scrollbar flex cursor-grab items-center gap-[8px] overflow-x-auto py-[10px] select-none active:cursor-grabbing"
        style={{ touchAction: "none" }}
      >
        {/* Спейсер: чтобы крайние недели доходили до центра */}
        <div className="shrink-0" style={{ width: "calc(50% - 26px)" }} aria-hidden />

        {weeks.map((w) => {
          const canSelect = selectable(w);
          const isSel = w.weekStart === selected;
          const cls = isSel
            ? "bg-[var(--color-accent)] text-white shadow-[0_4px_12px_rgba(0,119,255,0.35)] scale-110"
            : canSelect
              ? "bg-[var(--color-secondary-bg)] text-black"
              : "bg-[#f4f4f6] text-[#c3c6cb]";
          return (
            <button
              key={w.weekStart}
              type="button"
              data-week={w.weekStart}
              data-selectable={canSelect ? "1" : "0"}
              disabled={!canSelect}
              onClick={() => {
                // Игнорируем клик, если это было перетаскивание.
                if (drag.current.moved) return;
                if (canSelect && !isSel) onSelect(w.weekStart);
              }}
              className={`relative flex size-[52px] shrink-0 flex-col items-center justify-center rounded-[14px] font-montserrat text-[17px] font-black transition-all duration-200 ${cls}`}
              aria-label={`Неделя ${w.weekNumber}`}
              aria-pressed={isSel}
            >
              {w.weekNumber}
              {w.confirmed && (
                <span
                  className={`absolute -top-[4px] -right-[4px] flex size-[16px] items-center justify-center rounded-full text-[9px] font-bold ${
                    isSel ? "bg-white text-[var(--color-accent)]" : "bg-[var(--color-accrual)] text-white"
                  }`}
                  aria-label="Неделя подтверждена"
                >
                  ✓
                </span>
              )}
            </button>
          );
        })}

        <div className="shrink-0" style={{ width: "calc(50% - 26px)" }} aria-hidden />
      </div>
    </div>
  );
}
