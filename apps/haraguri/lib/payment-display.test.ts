import {describe,expect,it} from 'vitest';
import {categoryLabel,matchesPaymentFilter,paymentLabel} from './payment-display';

describe('payment details when no cards are registered',()=>{
  const row={payment_method:'other' as const,category:'기타',source:'push' as const,raw_text:'MG체크카드(1*6*) 29,000원 승인 10/27 19:10 네이버페이'};
  it('shows the observed card company and type without inventing a card registration',()=>{
    expect(paymentLabel(row)).toBe('새마을 체크카드 · 카드 미등록');
    expect(matchesPaymentFilter(row,'debit')).toBe(true);
    expect(matchesPaymentFilter(row,'credit')).toBe(false);
    expect(matchesPaymentFilter(row,'other')).toBe(false);
  });
  it('distinguishes an unknown spending category from unknown payment method',()=>{
    expect(categoryLabel(row)).toBe('분류 미확인');
    expect(paymentLabel({...row,raw_text:''})).toBe('결제수단 미확인');
    expect(categoryLabel({...row,source:'manual'})).toBe('기타');
  });
});
