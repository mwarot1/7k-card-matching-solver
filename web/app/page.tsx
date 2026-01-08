'use client';

import Link from 'next/link';
import styles from './page.module.css';

export default function Home() {
  return (
    <div className={styles.main}>
      <div className={styles.container}>
        <h1 className={styles.title}>7K Minigame Tools</h1>
        <p className={styles.subtitle}>
          Collection of tools to help you with Seven Knights minigames
        </p>

        <div className={styles.appGrid}>
          <Link href="/7k-card-matching-solver" className={styles.appCard}>
            <div className={styles.appIcon}>🃏</div>
            <h2 className={styles.appTitle}>Card Matching Solver</h2>
            <p className={styles.appDescription}>
              Advanced AI-powered solver for the card matching minigame. Analyze cards and get optimal solutions instantly.
            </p>
            <ul className={styles.appFeatures}>
              <li>Screen recording & video upload</li>
              <li>Real-time card detection</li>
              <li>Visual matching grid</li>
              <li>High accuracy recognition</li>
            </ul>
          </Link>

          <Link href="/coupon-usage" className={styles.appCard}>
            <div className={styles.appIcon}>🎫</div>
            <h2 className={styles.appTitle}>Coupon Redemption</h2>
            <p className={styles.appDescription}>
              Quickly redeem multiple active coupons for your account in one go.
            </p>
            <ul className={styles.appFeatures}>
              <li>Batch coupon redemption</li>
              <li>Multiple coupons at once</li>
              <li>Success/failure tracking</li>
              <li>Response details viewer</li>
            </ul>
          </Link>
        </div>
      </div>
    </div>
  );
}
