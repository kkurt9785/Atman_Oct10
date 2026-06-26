'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const MOCK_CREDITS = 15000;

type Category = 'all' | '신발' | '스타킹' | '케어' | '워치' | '야간' | '의료';

const CATEGORIES: { value: Category; label: string }[] = [
  { value: 'all',   label: '전체' },
  { value: '신발',  label: '👟 신발' },
  { value: '스타킹', label: '🧦 스타킹' },
  { value: '케어',  label: '🧴 케어' },
  { value: '워치',  label: '⌚ 워치' },
  { value: '야간',  label: '🌙 야간' },
  { value: '의료',  label: '✂️ 의료' },
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
  {
    id: 1,
    name: '의료용 크록스 슬리퍼',
    category: '신발',
    price: 32000,
    originalPrice: 42000,
    emoji: '👟',
    badge: '베스트',
    desc: '8~12시간 근무에 최적화된 의료용 슬리퍼',
  },
  {
    id: 2,
    name: '압박 스타킹 3팩',
    category: '스타킹',
    price: 16800,
    originalPrice: null,
    emoji: '🧦',
    badge: '소모품',
    desc: '장시간 서 있는 간호사 필수. 부종 예방',
  },
  {
    id: 3,
    name: '고용량 핸드크림 200ml',
    category: '케어',
    price: 12000,
    originalPrice: 15000,
    emoji: '🧴',
    badge: null,
    desc: '잦은 손 소독으로 건조해진 피부에',
  },
  {
    id: 4,
    name: '애플워치 실리콘 밴드 (위생형)',
    category: '워치',
    price: 14900,
    originalPrice: null,
    emoji: '⌚',
    badge: '신상',
    desc: '병원 내 착용 규정 맞춤 항균 실리콘',
  },
  {
    id: 5,
    name: '오버나이트 패드 10개입',
    category: '야간',
    price: 9800,
    originalPrice: null,
    emoji: '🌙',
    badge: '야간 필수',
    desc: '야간 근무 중 교체 어려운 상황 대비',
  },
  {
    id: 6,
    name: '간호사 가위 (밴디지)',
    category: '의료',
    price: 8900,
    originalPrice: 12000,
    emoji: '✂️',
    badge: null,
    desc: '드레싱·붕대 제거용 개인 휴대 가위',
  },
  {
    id: 7,
    name: '야간 서바이벌 키트',
    category: '야간',
    price: 22000,
    originalPrice: 28000,
    emoji: '🎒',
    badge: '묶음 할인',
    desc: '에너지 드링크 + 영양바 + 눈 찜질팩 세트',
  },
  {
    id: 8,
    name: '명찰 케이스 + 클립 세트',
    category: '의료',
    price: 6500,
    originalPrice: null,
    emoji: '🏷️',
    badge: null,
    desc: '슬라이딩 클립 + 투명 케이스 2개 포함',
  },
  {
    id: 9,
    name: '립밤 + 미니 핸드크림 세트',
    category: '케어',
    price: 8900,
    originalPrice: null,
    emoji: '💄',
    badge: null,
    desc: '마스크 착용으로 건조해진 입술·손 케어',
  },
  {
    id: 10,
    name: '압박 워킹 양말 (5켤레)',
    category: '스타킹',
    price: 13500,
    originalPrice: null,
    emoji: '🩹',
    badge: '재구매 1위',
    desc: '스타킹보다 편한 압박 기능 워킹 양말',
  },
];

const BADGE_STYLE: Record<string, string> = {
  '베스트':    'bg-red-50 text-red-500',
  '소모품':    'bg-blue-50 text-blue-500',
  '신상':      'bg-purple-50 text-purple-500',
  '야간 필수': 'bg-indigo-50 text-indigo-500',
  '묶음 할인': 'bg-green-50 text-green-500',
  '재구매 1위': 'bg-orange-50 text-orange-500',
};

function ProductCard({ product, credits }: { product: Product; credits: number }) {
  const [added, setAdded] = useState(false);
  const canPay = credits >= product.price;
  const discount = product.originalPrice
    ? Math.round((1 - product.price / product.originalPrice) * 100)
    : null;

  return (
    <div className="bg-white rounded-card shadow-card p-4 flex flex-col gap-3">
      {/* 이미지 영역 */}
      <div className="w-full aspect-square bg-bg rounded-xl flex items-center justify-center text-5xl">
        {product.emoji}
      </div>

      {/* 뱃지 + 이름 */}
      <div>
        {product.badge && (
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${BADGE_STYLE[product.badge] ?? 'bg-gray-100 text-gray-500'}`}>
            {product.badge}
          </span>
        )}
        <p className="text-[14px] font-bold text-ink mt-1 leading-snug">{product.name}</p>
        <p className="text-[11px] text-tertiary mt-0.5 leading-snug">{product.desc}</p>
      </div>

      {/* 가격 */}
      <div className="flex items-end gap-1.5">
        {discount && (
          <span className="text-[12px] font-bold text-primary">{discount}%</span>
        )}
        <span className="text-[17px] font-extrabold text-ink">
          ₩{product.price.toLocaleString('ko-KR')}
        </span>
        {product.originalPrice && (
          <span className="text-[11px] text-tertiary line-through mb-0.5">
            ₩{product.originalPrice.toLocaleString('ko-KR')}
          </span>
        )}
      </div>

      {/* 적립금 사용 가능 여부 */}
      {canPay && (
        <p className="text-[11px] text-primary font-semibold -mt-1">
          💰 적립금으로 결제 가능
        </p>
      )}

      {/* 버튼 */}
      <button
        onClick={() => setAdded(true)}
        className={`h-10 w-full rounded-btn text-[13px] font-bold transition-colors ${
          added
            ? 'bg-bg text-tertiary'
            : 'bg-primary text-white active:opacity-80'
        }`}
      >
        {added ? '장바구니 담김 ✓' : '담기'}
      </button>
    </div>
  );
}

export default function StorePage() {
  const router = useRouter();
  const [category, setCategory] = useState<Category>('all');

  const filtered = PRODUCTS.filter(
    (p) => category === 'all' || p.category === category
  );

  return (
    <div className="pb-10">
      {/* 헤더 */}
      <div className="bg-white sticky top-0 z-20 border-b border-line">
        <div className="flex items-center gap-3 px-5 pt-12 pb-3">
          <button
            onClick={() => router.back()}
            className="text-ink text-[20px] leading-none -ml-1 p-1"
          >
            ←
          </button>
          <h1 className="text-[18px] font-extrabold text-ink flex-1">간호용품 스토어</h1>
          {/* 적립금 뱃지 */}
          <div className="flex items-center gap-1 bg-primary/8 border border-primary/20 px-3 py-1.5 rounded-full">
            <span className="text-[12px] font-semibold text-primary">💰</span>
            <span className="text-[13px] font-extrabold text-primary">
              ₩{MOCK_CREDITS.toLocaleString('ko-KR')}
            </span>
          </div>
        </div>

        {/* 적립금 안내 배너 */}
        <div className="mx-5 mb-3 bg-primary/5 rounded-xl px-4 py-2.5 flex items-center gap-2">
          <span className="text-[16px]">🎁</span>
          <p className="text-[12px] text-primary font-semibold">
            시프트 매칭 적립금으로 결제하세요 · 현금처럼 사용 가능
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
          <ProductCard key={p.id} product={p} credits={MOCK_CREDITS} />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="flex flex-col items-center py-20 gap-2">
          <span className="text-5xl">🛒</span>
          <p className="text-[14px] font-bold text-ink">준비 중인 카테고리예요</p>
        </div>
      )}
    </div>
  );
}
