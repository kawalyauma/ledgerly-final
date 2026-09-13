import { describe, expect, it } from 'vitest';
import { receiptAmountInWords } from '../src/features/printerly/auto-receipts.js';

describe('automatic receipt printing',()=>{
  it('renders whole UGX amounts in words for printed receipts',()=>{
    expect(receiptAmountInWords(70000,'UGX')).toBe('Seventy thousand UGX only');
    expect(receiptAmountInWords(1250400,'UGX')).toBe('One million two hundred fifty thousand four hundred UGX only');
  });

  it('renders zero safely',()=>{
    expect(receiptAmountInWords(0,'UGX')).toBe('Zero UGX only');
  });
});
