'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const MOCK_CREDITS = 15000;
const SHIPPING_FEE = 3500;
const FREE_SHIPPING_THRESHOLD = 30000;

type Category = 'all' | '신발' | '스타킹' | '케어' | '워치' | '야간' | '의료';

const CATEGORIES: { value: Category; label: string }[] = [
  { value: 'all',    label: '전체' },
  { value: '신발',   label: '👟 신발' },
  { value: '스타킹', label: '🧦 스타킹' },
  { value: '케어',   label: '🧴 케어' },
  { value: '워치',   label: '⌚ 워치' },
  { value: '야간',   label: '🌙 야간' },
  { value: '의료',   label: '✂️ 의료' },
];

interface Product {
  id: number;
  name: string;
  category: Category;
  price: number;
  originalPrice: number | null;
  emoji: string;
  badge: string | null;
  desc: string;
}

const PRODUCTS: Product[] = [
  { id: 1, name: '의료용 크록스 슬리퍼', category: '신발', price: 32000, originalPrice: 42000, emoji: '👟', badge: '베스트', desc: '8~12시간 근무에 최적화된 의료용 슬리퍼' },
  { id: 2, name: '압박 스타킹 3팩', category: '스타킹', price: 16800, originalPrice: null, emoji: '🧦', badge: '소모품', desc: '장시간 서 있는 간호사 필수. 부종 예방' },
  { id: 3, name: '고용량 핸드크림 200ml', category: '케어', price: 12000, originalPrice: 15000, emoji: '🧴', badge: null, desc: '잦은 손 소독으로 건조해진 피부에' },
  { id: 4, name: '애플워치 실리콘 밴드 (위생형)', category: '워치', price: 14900, originalPrice: null, emoji: '⌚', badge: '신상', desc: '병원 내 착용 규정 맞춤 항균 실리콘' },
  { id: 5, name: '오버나이트 패드 10개입', category: '야간', price: 9800, originalPrice: null, emoji: '🌙', badge: '야간 필수', desc: '야간 근무 중 교체 어려운 상황 대비' },
  { id: 6, name: '간호사 가위 (밴디지)', category: '의료', price: 8900, originalPrice: 12000, emoji: '✂️', badge: null, desc: '드레싱·붕대 제거용 개인 휴대 가위' },
  { id: 7, name: '야간 서바이벌 키트', category: '야간', price: 22000, originalPrice: 28000, emoji: '🎒', badge: '묶음 할인', desc: '에너지 드링크 + 영양바 + 눈 찜질팩 세트' },
  { id: 8, name: '명찰 케이스 + 클립 세트', category: '의료', price: 6500, originalPrice: null, emoji: '🏷️', badge: null, desc: '슬라이딩 클립 + 투명 케이스 2개 포함' },
  { id: 9, name: '립밤 + 미니 핸드크림 세트', category: '케어', price: 8900, originalPrice: null, emoji: '💄', badge: null, desc: '마스크 착용으로 건조해진 입술·손 케어' },
  { id: 10, name: '압박 워킹 양말 5켤레', category: '스타킹', price: 13500, originalPrice: null, emoji: '🩹', badge: '재구매 1위', desc: '스타킹보다 편한 압박 기능 워킹 양말' },
];

const BADGE_STYLE: Record<string, string> = {
  '베스트':     'bg-red-50 text-red-500',
  '소모품':     'bg-blue-50 text-blue-500',
  '신상':       'bg-purple-50 text-purple-500',
  '야간 필수':  'bg-indigo-50 text-indigo-500',
  '묶음 할인':  'bg-green-50 text-green-500',
  '재구매 1위': 'bg-orange-50 text-orange-500',
};

// ─── 서브 컴포넌트 ─────────────────────────────────────────────

function ProductCard({
  product,
  qty,
  onAdd,
  onRemove,
}: {
  product: Product;
  qty: number;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const discount = product.originalPrice
    ? Math.round((1 - product.price / product.originalPrice) * 100)
    : null;

  return (
    <div className="bg-white rounded-card shadow-card p-4 flex flex-col gap-3">
      <div className="w-full aspect-square bg-bg rounded-xl flex items-center justify-center text-5xl">
        {product.emoji}
      </div>

      <div>
        {product.badge && (
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${BADGE_STYLE[product.badge] ?? 'bg-gray-100 text-gray-500'}`}>
            {product.badge}
          </span>
        )}
        <p className="text-[14px] font-bold text-ink mt-1 leading-snug">{product.name}</p>
        <p className="text-[11px] text-tertiary mt-0.5 leading-snug">{product.desc}</p>
      </div>

      <div className="flex items-end gap-1.5">
        {discount && <span className="text-[12px] font-bold text-primary">{discount}%</span>}
        <span className="text-[17px] font-extrabold text-ink">₩{product.price.toLocaleString('ko-KR')}</span>
        {product.originalPrice && (
          <span className="text-[11px] text-tertiary line-through mb-0.5">
            ₩{product.originalPrice.toLocaleString('ko-KR')}
          </span>
        )}
      </div>

      {/* 수량 조절 or 담기 버튼 */}
      {qty === 0 ? (
        <button
          onClick={onAdd}
          className="h-10 w-full rounded-btn bg-primary text-white text-[13px] font-bold active:opacity-80"
        >
          담기
        </button>
      ) : (
        <div className="h-10 flex items-center justify-between bg-primary/8 rounded-btn px-2">
          <button
            onClick={onRemove}
            className="w-8 h-8 flex items-center justify-center text-primary text-[20px] font-bold active:opacity-60"
          >
            −
          </button>
          <span className="text-[15px] font-extrabold text-primary">{qty}</span>
          <button
            onClick={onAdd}
            className="w-8 h-8 flex items-center justify-center text-primary text-[20px] font-bold active:opacity-60"
          >
            +
          </button>
        </div>
      )}
    </div>
  );
}

function CartSheet({
  cart,
  credits,
  onClose,
  onQtyChange,
}: {
  cart: Record<number, number>;
  credits: number;
  onClose: () => void;
  onQtyChange: (id: number, delta: number) => void;
}) {
  const [useCreditsForShipping, setUseCreditsForShipping] = useState(false);

  const cartItems = PRODUCTS.filter((p) => (cart[p.id] ?? 0) > 0);
  const subtotal = cartItems.reduce((sum, p) => sum + p.price * (cart[p.id] ?? 0), 0);
  const needsShipping = subtotal < FREE_SHIPPING_THRESHOLD;
  const shipping = needsShipping ? SHIPPING_FEE : 0;
  const remaining = FREE_SHIPPING_THRESHOLD - subtotal;
  const progress = Math.min(100, (subtotal / FREE_SHIPPING_THRESHOLD) * 100);
  const shippingAfterCredit = useCreditsForShipping && needsShipping ? 0 : shipping;
  const total = subtotal + shippingAfterCredit;

  return (
    <>
      {/* 딤드 배경 */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
      />
      {/* 바텀 시트 */}
      <div className="fixed bottom-0 inset-x-0 mx-auto max-w-app bg-white rounded-t-3xl z-50 max-h-[85vh] flex flex-col">
        {/* 핸들 */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 bg-line rounded-full" />
        </div>

        <div className="px-5 pb-2 flex items-center justify-between">
          <h2 className="text-[18px] font-extrabold text-ink">장바구니</h2>
          <span className="text-[13px] text-tertiary">{cartItems.length}종</span>
        </div>

        {/* 무료 배송 프로그레스 바 */}
        <div className="mx-5 mb-4 bg-bg rounded-2xl p-3.5">
          {needsShipping ? (
            <>
              <p className="text-[12px] font-semibold text-sub mb-2">
                🚚 <span className="text-primary font-extrabold">₩{remaining.toLocaleString('ko-KR')}</span> 더 담으면 무료배송!
              </p>
              <div className="w-full h-2 bg-line rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </>
          ) : (
            <p className="text-[13px] font-bold text-green-600">🎉 무료배송 달성!</p>
          )}
        </div>

        {/* 아이템 목록 */}
        <div className="flex-1 overflow-y-auto px-5 pb-2 flex flex-col gap-3">
          {cartItems.map((p) => (
            <div key={p.id} className="flex items-center gap-3 bg-bg rounded-2xl p-3">
              <span className="text-3xl flex-shrink-0">{p.emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-bold text-ink leading-snug truncate">{p.name}</p>
                <p className="text-[13px] font-extrabold text-primary mt-0.5">
                  ₩{(p.price * (cart[p.id] ?? 0)).toLocaleString('ko-KR')}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => onQtyChange(p.id, -1)}
                  className="w-7 h-7 rounded-full bg-white border border-line text-ink text-[16px] font-bold flex items-center justify-center active:opacity-60"
                >
                  −
                </button>
                <span className="text-[14px] font-extrabold text-ink w-4 text-center">
                  {cart[p.id]}
                </span>
                <button
                  onClick={() => onQtyChange(p.id, +1)}
                  className="w-7 h-7 rounded-full bg-white border border-line text-ink text-[16px] font-bold flex items-center justify-center active:opacity-60"
                >
                  +
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* 금액 요약 */}
        <div className="px-5 pt-3 border-t border-line">
          <div className="flex justify-between text-[13px] text-sub mb-1.5">
            <span>상품 합계</span>
            <span>₩{subtotal.toLocaleString('ko-KR')}</span>
          </div>

          <div className="flex justify-between items-center text-[13px] mb-3">
            <span className="text-sub">배송비</span>
            {needsShipping ? (
              <div className="flex items-center gap-2">
                {useCreditsForShipping ? (
                  <span className="text-primary font-bold">적립금 차감 (-₩{SHIPPING_FEE.toLocaleString('ko-KR')})</span>
                ) : (
                  <span className="text-sub">₩{SHIPPING_FEE.toLocaleString('ko-KR')}</span>
                )}
              </div>
            ) : (
              <span className="text-green-600 font-bold">무료</span>
            )}
          </div>

          {/* 적립금으로 배송비 결제 토글 */}
          {needsShipping && credits >= SHIPPING_FEE && (
            <button
              onClick={() => setUseCreditsForShipping((v) => !v)}
              className="w-full flex items-center justify-between bg-primary/5 border border-primary/20 rounded-xl px-4 py-3 mb-3 active:opacity-70"
            >
              <div className="flex items-center gap-2">
                <span className="text-[16px]">💰</span>
                <div className="text-left">
                  <p className="text-[12px] font-bold text-primary">적립금으로 배송비 결제</p>
                  <p className="text-[11px] text-tertiary">잔액 ₩{credits.toLocaleString('ko-KR')} → -₩{SHIPPING_FEE.toLocaleString('ko-KR')}</p>
                </div>
              </div>
              <div className={`w-11 h-6 rounded-full transition-colors ${useCreditsForShipping ? 'bg-primary' : 'bg-line'}`}>
                <div className={`w-5 h-5 bg-white rounded-full shadow mt-0.5 transition-transform ${useCreditsForShipping ? 'translate-x-5.5' : 'translate-x-0.5'}`} />
              </div>
            </button>
          )}

          <div className="flex justify-between text-[16px] font-extrabold text-ink mb-4">
            <span>최종 결제</span>
            <span className="text-primary">₩{total.toLocaleString('ko-KR')}</span>
          </div>

          <button className="w-full h-14 bg-primary text-white text-[16px] font-extrabold rounded-btn shadow-btn mb-safe active:opacity-80">
            결제하기
          </button>
        </div>
      </div>
    </>
  );
}

// ─── 메인 ─────────────────────────────────────────────────────

export default function StorePage() {
  const router = useRouter();
  const [category, setCategory]   = useState<Category>('all');
  const [cart, setCart]           = useState<Record<number, number>>({});
  const [showCart, setShowCart]   = useState(false);

  const totalQty     = Object.values(cart).reduce((s, q) => s + q, 0);
  const subtotal     = PRODUCTS.reduce((s, p) => s + p.price * (cart[p.id] ?? 0), 0);
  const needsShipping = subtotal < FREE_SHIPPING_THRESHOLD && subtotal > 0;
  const remaining    = FREE_SHIPPING_THRESHOLD - subtotal;
  const progress     = Math.min(100, (subtotal / FREE_SHIPPING_THRESHOLD) * 100);

  function handleQty(id: number, delta: number) {
    setCart((prev) => {
      const next = { ...prev, [id]: Math.max(0, (prev[id] ?? 0) + delta) };
      if (next[id] === 0) delete next[id];
      return next;
    });
  }

  const filtered = PRODUCTS.filter((p) => category === 'all' || p.category === category);

  return (
    <div className="pb-32">
      {/* 헤더 */}
      <div className="bg-white sticky top-0 z-20 border-b border-line">
        <div className="flex items-center gap-3 px-5 pt-12 pb-3">
          <button onClick={() => router.back()} className="text-ink text-[20px] leading-none -ml-1 p-1">
            ←
          </button>
          <h1 className="text-[18px] font-extrabold text-ink flex-1">간호용품 스토어</h1>
          <div className="flex items-center gap-1 bg-primary/8 border border-primary/20 px-3 py-1.5 rounded-full">
            <span className="text-[12px]">💰</span>
            <span className="text-[13px] font-extrabold text-primary">
              ₩{MOCK_CREDITS.toLocaleString('ko-KR')}
            </span>
          </div>
        </div>

        {/* 적립금 안내 배너 */}
        <div className="mx-5 mb-3 bg-primary/5 rounded-xl px-4 py-2.5 flex items-center gap-2">
          <span className="text-[15px]">🎁</span>
          <p className="text-[12px] text-primary font-semibold">
            시프트 적립금으로 결제 가능 · 배송비도 적립금으로 OK
          </p>
        </div>

        {/* 카테고리 탭 */}
        <div className="flex gap-2 overflow-x-auto scrollbar-hide px-5 pb-3">
          {CATEGORIES.map((c) => (
            <button
              key={c.value}
              onClick={() => setCategory(c.value)}
              className={`whitespace-nowrap px-3.5 py-2 rounded-full text-[12px] font-semibold flex-shrink-0 transition-colors ${
                category === c.value ? 'bg-primary text-white' : 'bg-bg text-sub'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* 상품 그리드 */}
      <div className="grid grid-cols-2 gap-3 px-4 pt-4">
        {filtered.map((p) => (
          <ProductCard
            key={p.id}
            product={p}
            qty={cart[p.id] ?? 0}
            onAdd={() => handleQty(p.id, +1)}
            onRemove={() => handleQty(p.id, -1)}
          />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="flex flex-col items-center py-20 gap-2">
          <span className="text-5xl">🛒</span>
          <p className="text-[14px] font-bold text-ink">준비 중인 카테고리예요</p>
        </div>
      )}

      {/* 하단 장바구니 바 — 담은 상품 있을 때만 */}
      {totalQty > 0 && (
        <div className="fixed bottom-0 inset-x-0 mx-auto max-w-app z-30 px-4 pb-4 pt-2 bg-gradient-to-t from-white via-white to-transparent">
          {/* 무료배송 프로그레스 */}
          {needsShipping && (
            <div className="mb-2 px-1">
              <div className="flex justify-between text-[11px] font-semibold mb-1">
                <span className="text-sub">
                  🚚 <span className="text-primary">₩{remaining.toLocaleString('ko-KR')}</span> 더 담으면 무료배송
                </span>
                <span className="text-tertiary">{Math.round(progress)}%</span>
              </div>
              <div className="w-full h-1.5 bg-line rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}
          {!needsShipping && subtotal > 0 && (
            <p className="text-[11px] font-bold text-green-600 text-center mb-1.5">🎉 무료배송 달성!</p>
          )}

          {/* 장바구니 버튼 */}
          <button
            onClick={() => setShowCart(true)}
            className="w-full h-14 bg-primary text-white rounded-btn shadow-btn flex items-center justify-between px-5 active:opacity-80"
          >
            <span className="bg-white/20 text-white text-[13px] font-bold px-2.5 py-1 rounded-full">
              {totalQty}개
            </span>
            <span className="text-[15px] font-extrabold">장바구니 보기</span>
            <span className="text-[15px] font-extrabold">
              ₩{subtotal.toLocaleString('ko-KR')}
            </span>
          </button>
        </div>
      )}

      {/* 장바구니 시트 */}
      {showCart && (
        <CartSheet
          cart={cart}
          credits={MOCK_CREDITS}
          onClose={() => setShowCart(false)}
          onQtyChange={handleQty}
        />
      )}
    </div>
  );
}
