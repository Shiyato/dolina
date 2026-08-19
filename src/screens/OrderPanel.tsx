import { useEffect, useMemo, useState } from "react";
import type { Customer } from "../services/types";
import {
  fetchFavorites,
  fetchMenu,
  submitOrder,
  type Favorites,
  type MenuItem,
  type OrderMenu,
  type OrderResult,
} from "../services/api";

/** ₽ по-русски: 1240 → «1 240». */
const money = (n: number) => n.toLocaleString("ru-RU");

type Cart = Record<string, { item: MenuItem; amount: number }>;

/**
 * Панель «огонёк» — дистанционный заказ на самовывоз. Сверху любимые позиции
 * гостя, ниже меню по категориям. Корзина копится внизу, оформление — в
 * нижнем листе с онлайн-оплатой (пока заглушка: провайдер подключим позже,
 * реальный заказ в iiko создаётся, только когда настроят оплату и внешнее меню).
 */
export default function OrderPanel({ customer }: { customer: Customer }) {
  const [menu, setMenu] = useState<OrderMenu | null>(null);
  const [fav, setFav] = useState<Favorites | null>(null);
  const [cart, setCart] = useState<Cart>({});
  const [checkout, setCheckout] = useState(false);

  useEffect(() => {
    fetchMenu().then(setMenu).catch(() => setMenu({ source: "empty", updatedAt: "", categories: [] }));
    fetchFavorites(customer.id).then(setFav).catch(() => setFav({ drinks: [], food: [] }));
  }, [customer.id]);

  const add = (item: MenuItem) =>
    setCart((c) => ({ ...c, [item.id]: { item, amount: (c[item.id]?.amount ?? 0) + 1 } }));
  const dec = (id: string) =>
    setCart((c) => {
      const cur = c[id];
      if (!cur) return c;
      const rest = { ...c };
      if (cur.amount <= 1) delete rest[id];
      else rest[id] = { ...cur, amount: cur.amount - 1 };
      return rest;
    });

  const entries = Object.values(cart);
  const count = entries.reduce((s, e) => s + e.amount, 0);
  const total = entries.reduce((s, e) => s + e.amount * e.item.price, 0);

  // Любимые позиции, для которых нашлась позиция в меню (по имени) — их можно
  // добавить в корзину; остальные показываем как есть (заказать пока нечем).
  const menuByName = useMemo(() => {
    const m = new Map<string, MenuItem>();
    for (const c of menu?.categories ?? []) for (const it of c.items) m.set(it.name, it);
    return m;
  }, [menu]);
  const favItems = [...(fav?.drinks ?? []), ...(fav?.food ?? [])];

  if (!menu) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Прокручиваемое тело: любимое + меню */}
      <div className="min-h-0 flex-1 overflow-y-auto pt-[16px] pb-[8px]">
        {/* Любимое */}
        <section>
          <h2 className="font-montserrat text-[17px] font-black tracking-[-0.3px] text-black">
            🔥 Ваше любимое
          </h2>
          {favItems.length > 0 ? (
            <div className="mt-[10px] flex flex-wrap gap-[8px]">
              {favItems.map((f) => {
                const item = menuByName.get(f.name);
                return (
                  <button
                    key={f.productId}
                    type="button"
                    disabled={!item}
                    onClick={() => item && add(item)}
                    className={`rounded-full px-[12px] py-[8px] font-sans text-[13px] font-medium ${
                      item
                        ? "bg-black text-white"
                        : "bg-[var(--color-secondary-bg)] text-[var(--color-muted)]"
                    }`}
                  >
                    {f.name}
                    {item ? ` · ${money(item.price)}₽` : ""}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="mt-[8px] font-sans text-[13px] leading-[18px] text-[var(--color-muted)]">
              Здесь появятся ваши любимые напитки и блюда — как только вы сделаете
              несколько заказов.
            </p>
          )}
        </section>

        {/* Меню по категориям */}
        {menu.categories.map((c) => (
          <section key={c.name} className="mt-[22px]">
            <h3 className="font-montserrat text-[15px] font-black tracking-[-0.3px] text-black">
              {c.name}
            </h3>
            <div className="mt-[8px] flex flex-col">
              {c.items.map((it, i) => {
                const amount = cart[it.id]?.amount ?? 0;
                return (
                  <div
                    key={it.id}
                    className={`flex items-center gap-[12px] py-[11px] ${
                      i > 0 ? "border-t border-black/[0.06]" : ""
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-sans text-[14px] leading-[18px] text-black">{it.name}</p>
                      <p className="mt-[2px] font-sans text-[13px] font-semibold text-[var(--color-muted)]">
                        {money(it.price)} ₽
                      </p>
                    </div>
                    {amount > 0 ? (
                      <Stepper
                        amount={amount}
                        onDec={() => dec(it.id)}
                        onInc={() => add(it)}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => add(it)}
                        aria-label={`Добавить ${it.name}`}
                        className="tap size-[32px] shrink-0 rounded-full bg-[var(--color-secondary-bg)] text-[20px] leading-none text-black"
                      >
                        +
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        {menu.source === "empty" && (
          <p className="mt-[24px] text-center font-sans text-[14px] text-[var(--color-muted)]">
            Меню скоро появится.
          </p>
        )}
      </div>

      {/* Кнопка оформления (появляется, когда в корзине есть позиции) */}
      {count > 0 && (
        <button
          type="button"
          onClick={() => setCheckout(true)}
          className="tap mb-[8px] flex h-[56px] w-full shrink-0 items-center justify-between rounded-full bg-black px-[22px] text-white"
        >
          <span className="font-sans text-[15px] font-semibold">Оформить · {count}</span>
          <span className="font-montserrat text-[17px] font-black">{money(total)} ₽</span>
        </button>
      )}

      {checkout && (
        <CheckoutSheet
          customer={customer}
          entries={entries}
          total={total}
          onClose={() => setCheckout(false)}
          onDone={() => {
            setCart({});
            setCheckout(false);
          }}
          onDec={dec}
          onInc={(id) => {
            const e = cart[id];
            if (e) add(e.item);
          }}
        />
      )}
    </div>
  );
}

/** Счётчик количества позиции. */
function Stepper({
  amount,
  onDec,
  onInc,
}: {
  amount: number;
  onDec: () => void;
  onInc: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-[10px]">
      <button
        type="button"
        onClick={onDec}
        aria-label="Убрать"
        className="tap size-[32px] rounded-full bg-[var(--color-secondary-bg)] text-[20px] leading-none text-black"
      >
        −
      </button>
      <span className="w-[18px] text-center font-montserrat text-[16px] font-black tabular-nums text-black">
        {amount}
      </span>
      <button
        type="button"
        onClick={onInc}
        aria-label="Добавить ещё"
        className="tap size-[32px] rounded-full bg-black text-[20px] leading-none text-white"
      >
        +
      </button>
    </div>
  );
}

/** Нижний лист оформления: состав, комментарий, онлайн-оплата (заглушка). */
function CheckoutSheet({
  customer,
  entries,
  total,
  onClose,
  onDone,
  onDec,
  onInc,
}: {
  customer: Customer;
  entries: { item: MenuItem; amount: number }[];
  total: number;
  onClose: () => void;
  onDone: () => void;
  onDec: (id: string) => void;
  onInc: (id: string) => void;
}) {
  const [comment, setComment] = useState("");
  const [paying, setPaying] = useState(false);
  const [result, setResult] = useState<OrderResult | null>(null);

  const pay = async () => {
    setPaying(true);
    try {
      const r = await submitOrder({
        customerId: customer.id,
        phone: customer.phone,
        items: entries.map((e) => ({
          id: e.item.id,
          name: e.item.name,
          price: e.item.price,
          amount: e.amount,
        })),
        comment: comment.trim() || undefined,
      });
      setResult(r);
    } catch {
      setResult(null);
      setPaying(false);
    }
  };

  return (
    <div className="absolute inset-0 z-50 flex items-end bg-black/40" onClick={onClose}>
      <div
        className="animate-rise flex max-h-[92%] w-full flex-col rounded-t-[28px] bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 px-[24px] pt-[12px]">
          <div className="mx-auto mb-[12px] h-[5px] w-[40px] rounded-full bg-black/15" />
        </div>

        {result ? (
          // Успех оформления — крупный номер заказа (стиль Додо/Дринкит).
          <div className="flex flex-col items-center px-[24px] pb-[28px] pt-[8px] text-center">
            <div className="flex size-[60px] items-center justify-center rounded-full bg-[var(--color-accrual)]/15 text-[32px]">
              ✓
            </div>
            <p className="mt-[12px] font-montserrat text-[20px] font-black text-black">
              Заказ принят
            </p>
            <p className="mt-[2px] font-sans text-[14px] text-[var(--color-muted)]">
              Назовите номер на кассе «Долина Кофе»
            </p>

            {/* Крупный номер заказа */}
            <div className="mt-[18px] w-full rounded-[22px] bg-[var(--color-secondary-bg)] py-[22px]">
              <p className="font-sans text-[13px] tracking-[0.3px] text-[var(--color-muted)] uppercase">
                Ваш заказ
              </p>
              <p className="mt-[2px] font-montserrat text-[52px] font-black leading-none tracking-[-1px] text-black">
                №{result.orderNumber}
              </p>
            </div>

            <p className="mt-[14px] font-sans text-[15px] text-black">
              Оплачено {money(result.total)} ₽
            </p>

            {result.mode === "stub" && (
              <p className="mt-[10px] rounded-[12px] bg-[#fff3e0] px-[12px] py-[8px] font-sans text-[12px] leading-[16px] text-black">
                Тестовый режим: оплата и отправка на кухню — заглушка, реальный
                заказ ещё не создаётся.
              </p>
            )}
            <button
              type="button"
              onClick={onDone}
              className="tap mt-[18px] h-[52px] w-full rounded-full bg-black font-sans text-[16px] font-semibold text-white"
            >
              Готово
            </button>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-[24px]">
              <p className="font-montserrat text-[22px] font-black text-black">Ваш заказ</p>
              <p className="mt-[2px] font-sans text-[13px] text-[var(--color-muted)]">
                Самовывоз · оплата онлайн
              </p>

              <div className="mt-[14px] flex flex-col">
                {entries.map((e, i) => (
                  <div
                    key={e.item.id}
                    className={`flex items-center gap-[12px] py-[10px] ${
                      i > 0 ? "border-t border-black/[0.06]" : ""
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-sans text-[14px] leading-[18px] text-black">
                        {e.item.name}
                      </p>
                      <p className="mt-[2px] font-sans text-[13px] font-semibold text-[var(--color-muted)]">
                        {money(e.item.price)} ₽
                      </p>
                    </div>
                    <Stepper
                      amount={e.amount}
                      onDec={() => onDec(e.item.id)}
                      onInc={() => onInc(e.item.id)}
                    />
                  </div>
                ))}
              </div>

              <input
                value={comment}
                onChange={(ev) => setComment(ev.target.value)}
                placeholder="Комментарий к заказу"
                className="mt-[14px] w-full rounded-[14px] border border-black/[0.10] bg-white px-[14px] py-[11px] font-sans text-[15px] text-black"
              />
            </div>

            <div className="shrink-0 px-[24px] pb-[24px] pt-[12px]">
              <button
                type="button"
                onClick={pay}
                disabled={paying}
                className="tap flex h-[56px] w-full items-center justify-center gap-[8px] rounded-full bg-black font-sans text-[16px] font-semibold text-white disabled:opacity-60"
              >
                {paying ? "Оплата…" : `Оплатить ${money(total)} ₽`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="size-[26px] animate-spin text-[var(--color-muted)]"
      viewBox="0 0 24 24"
      fill="none"
      aria-label="Загрузка"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
