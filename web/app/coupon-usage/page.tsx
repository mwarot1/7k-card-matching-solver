'use client';

import { useState, useEffect } from 'react';
import styles from './page.module.css';
import couponConfig from '../../config/coupons.json';

interface CouponResult {
  success: boolean;
  couponCode: string;
  message?: string;
  data?: any;
}

export default function CouponUsage() {
  const [memberId, setMemberId] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<CouponResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [coupons, setCoupons] = useState<string[]>([]);

  // Load coupons from Google Sheets on mount, fall back to JSON config if it fails
  useEffect(() => {
    const loadCoupons = async () => {
      try {
        const response = await fetch('/api/get-coupons');
        const data = await response.json();

        if (response.ok && data.coupons.length > 0) {
          // Successfully loaded from Google Sheets
          setCoupons(data.coupons);
          console.log('✅ Loaded coupons from Google Sheets');
        } else {
          // Fall back to JSON config
          setCoupons(couponConfig.coupons);
          console.log('⚠️ Using fallback JSON config');
        }
      } catch (err) {
        // Fall back to JSON config on error
        console.log('⚠️ Google Sheets unavailable, using fallback JSON config');
        setCoupons(couponConfig.coupons);
      }
    };

    loadCoupons();
  }, []);

  const handleRedeemCoupons = async () => {
    if (!memberId.trim()) {
      setError('Please enter a Member ID');
      return;
    }

    if (coupons.length === 0) {
      setError('Please enter at least one coupon code');
      return;
    }

    setLoading(true);
    setError(null);
    setResults([]);

    const newResults: CouponResult[] = [];
    let shouldStop = false;

    for (const coupon of coupons) {
      // Trim whitespace from coupon code
      const trimmedCoupon = coupon.trim();
      
      // Skip empty coupons
      if (!trimmedCoupon) {
        continue;
      }
      
      if (shouldStop) {
        // Skip remaining coupons if UID is invalid
        newResults.push({
          success: false,
          couponCode: trimmedCoupon,
          message: 'Skipped due to invalid Member ID',
        });
        continue;
      }

      try {
        // Use Next.js API route as proxy
        const url = `/api/redeem-coupon?couponCode=${encodeURIComponent(trimmedCoupon)}&memberId=${encodeURIComponent(memberId)}`;
        
        console.log('🔵 Redeeming coupon:', trimmedCoupon);
        
        const response = await fetch(url, {
          method: 'GET',
        });

        const data = await response.json();
        console.log('✅ Response:', data);

        // Check for error responses
        let success = response.ok;
        let message = '';
        
        // Handle API error responses with httpStatus 400
        if (data.httpStatus === 400 || data.errorCode) {
          success = false;
          
          // Check for invalid UID error (errorCode 21002)
          if (data.errorCode === 21002) {
            message = 'Invalid Member ID. Please check your Member ID and try again.';
            shouldStop = true; // Stop processing remaining coupons
          } else if (data.errorCode === 24001) {
            // Too many wrong coupon attempts
            message = 'You have redeemed too many wrong coupons. Please try again after 1 hour.';
            shouldStop = true; // Stop processing remaining coupons
          } else if (data.errorCode === 24002) {
            // Invalid coupon
            message = 'The coupon is invalid.';
          } else if (data.errorCode === 24004) {
            // Coupon already used or usage limit exceeded
            message = 'The coupon is already used or exceed usage limit.';
          } else {
            // Other errors: use generic message instead of Korean errorMessage
            message = `Error ${data.errorCode || 'Unknown'}: Coupon redemption failed`;
          }
        } else {
          // Success case
          message = data.message || data.resultMessage || 'Successfully redeemed';
        }

        newResults.push({
          success: success,
          couponCode: trimmedCoupon,
          message: message,
          data: data,
        });

        // If invalid UID, break the loop after showing the error
        if (shouldStop) {
          setError('Invalid Member ID detected. Please check your Member ID and try again.');
          break;
        }
      } catch (err) {
        console.error('❌ Error redeeming coupon:', err);
        
        newResults.push({
          success: false,
          couponCode: trimmedCoupon,
          message: err instanceof Error ? err.message : 'Network error',
        });
      }
    }

    setResults(newResults);
    setLoading(false);
  };

  const handleAddCoupon = () => {
    setCoupons([...coupons, '']);
  };

  const handleRemoveCoupon = (index: number) => {
    setCoupons(coupons.filter((_, i) => i !== index));
  };

  const handleCouponChange = (index: number, value: string) => {
    // Normal single value change
    const newCoupons = [...coupons];
    newCoupons[index] = value;
    setCoupons(newCoupons);
  };

  const handleCouponPaste = (index: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    const pastedText = e.clipboardData.getData('text');
    
    // Check if the pasted text contains newlines
    if (pastedText.includes('\n')) {
      e.preventDefault(); // Prevent default paste behavior
      
      // Split by newlines and filter out empty strings
      const pastedCoupons = pastedText.split('\n').map(c => c.trim()).filter(c => c.length > 0);
      
      if (pastedCoupons.length > 1) {
        // Multiple coupons pasted - replace current field and add new ones
        const beforeCurrent = coupons.slice(0, index);
        const afterCurrent = coupons.slice(index + 1);
        const newCoupons = [...beforeCurrent, ...pastedCoupons, ...afterCurrent];
        
        setCoupons(newCoupons);
      } else if (pastedCoupons.length === 1) {
        // Single coupon with newline, just set it
        const newCoupons = [...coupons];
        newCoupons[index] = pastedCoupons[0];
        setCoupons(newCoupons);
      }
    }
  };

  const handleCouponKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Add a new empty coupon field after the current one
      const newCoupons = [...coupons];
      newCoupons.splice(index + 1, 0, '');
      setCoupons(newCoupons);
      
      // Focus on the new field after a brief delay
      setTimeout(() => {
        const inputs = document.querySelectorAll('input[placeholder^="Coupon code"]');
        if (inputs[index + 1]) {
          (inputs[index + 1] as HTMLInputElement).focus();
        }
      }, 0);
    }
  };

  return (
    <div className={styles.main}>
      <div className={styles.container}>
        <h1 className={styles.title}>Coupon Redemption</h1>
        <p className={styles.description}>
          Automatically redeem all active coupons for your account
        </p>

        <div className={styles.form}>
          <div className={styles.inputGroup}>
            <label htmlFor="memberId" className={styles.label}>
              Member ID
            </label>
            <input
              id="memberId"
              type="text"
              className={styles.input}
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
              placeholder="Enter your Member ID"
              disabled={loading}
            />
          </div>

          <div className={styles.inputGroup}>
            <div className={styles.labelRow}>
              <label className={styles.label}>Coupon Codes ({coupons.length})</label>
              <button
                type="button"
                className={styles.addButton}
                onClick={handleAddCoupon}
                disabled={loading}
              >
                + Add Coupon
              </button>
            </div>
            
            <p className={styles.tip}>
              💡 Tip: You can paste multiple coupons from clipboard (one per line) or press Enter to add a new field
            </p>
            
            {coupons.map((coupon, index) => (
              <div key={index} className={styles.couponRow}>
                <input
                  type="text"
                  className={styles.input}
                  value={coupon}
                  onChange={(e) => handleCouponChange(index, e.target.value)}
                  onPaste={(e) => handleCouponPaste(index, e)}
                  onKeyDown={(e) => handleCouponKeyDown(index, e)}
                  placeholder={`Coupon code ${index + 1}`}
                  disabled={loading}
                />
                <button
                  type="button"
                  className={styles.removeButton}
                  onClick={() => handleRemoveCoupon(index)}
                  disabled={loading}
                >
                  ×
                </button>
              </div>
            ))}

            {coupons.length === 0 && (
              <p className={styles.hint}>No coupons loaded. Click "Add Coupon" to add coupon codes manually.</p>
            )}
          </div>

          {error && (
            <div className={styles.error}>
              {error}
            </div>
          )}

          <button
            className={styles.redeemButton}
            onClick={handleRedeemCoupons}
            disabled={loading || !memberId.trim() || coupons.length === 0}
          >
            {loading ? 'Redeeming...' : `Redeem ${coupons.length} Coupon${coupons.length !== 1 ? 's' : ''}`}
          </button>
        </div>

        {results.length > 0 && (
          <div className={styles.results}>
            <h2 className={styles.resultsTitle}>Redemption Results</h2>
            {results.map((result, index) => (
              <div
                key={index}
                className={`${styles.resultCard} ${result.success ? styles.success : styles.failed}`}
              >
                <div className={styles.resultHeader}>
                  <span className={styles.couponCode}>{result.couponCode}</span>
                  <span className={styles.status}>
                    {result.success ? '✓ Success' : '✗ Failed'}
                  </span>
                </div>
                {result.message && (
                  <p className={styles.resultMessage}>{result.message}</p>
                )}
                {result.data && (
                  <details className={styles.details}>
                    <summary>View Response</summary>
                    <pre className={styles.responseData}>
                      {JSON.stringify(result.data, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
