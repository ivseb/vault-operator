import { describe, it, expect } from 'vitest';
import { ContextTracker } from '../ContextTracker';

describe('ContextTracker', () => {
    describe('getContextUsage', () => {
        it('should return 0% usage initially', () => {
            const tracker = new ContextTracker(100000);
            const usage = tracker.getContextUsage();
            expect(usage.percentage).toBe(0);
            expect(usage.tokensUsed).toBe(0);
            expect(usage.maxTokens).toBe(100000);
        });

        it('should calculate percentage correctly after updateUsage', () => {
            const tracker = new ContextTracker(100000);
            tracker.updateUsage(40000, 10000);
            const usage = tracker.getContextUsage();
            expect(usage.percentage).toBe(50);
            expect(usage.tokensUsed).toBe(50000);
        });

        it('should set tokens used (not accumulate) on multiple updates', () => {
            const tracker = new ContextTracker(100000);
            tracker.updateUsage(30000, 10000);
            tracker.updateUsage(50000, 10000);
            expect(tracker.getContextUsage().tokensUsed).toBe(60000);
        });

        it('should calculate available size correctly', () => {
            const tracker = new ContextTracker(100000, 8192);
            tracker.updateUsage(50000, 0);
            const usage = tracker.getContextUsage();
            expect(usage.availableSize).toBe(100000 - 50000 - 8192);
            expect(usage.reservedForOutput).toBe(8192);
        });

        it('should clamp available size to 0 when overflowed', () => {
            const tracker = new ContextTracker(100000, 8192);
            tracker.updateUsage(95000, 5000);
            expect(tracker.getContextUsage().availableSize).toBe(0);
        });

        it('should return 0% when context window is 0', () => {
            const tracker = new ContextTracker(0);
            tracker.updateUsage(1000, 0);
            expect(tracker.getContextUsage().percentage).toBe(0);
        });
    });

    describe('setTotalTokens', () => {
        it('should directly set tokensUsed', () => {
            const tracker = new ContextTracker(100000);
            tracker.setTotalTokens(42000);
            expect(tracker.getContextUsage().tokensUsed).toBe(42000);
        });
    });

    describe('updateContextWindow', () => {
        it('should update context window and max output tokens', () => {
            const tracker = new ContextTracker(100000, 8192);
            tracker.updateContextWindow(200000, 16384);
            const usage = tracker.getContextUsage();
            expect(usage.maxTokens).toBe(200000);
            expect(usage.reservedForOutput).toBe(16384);
        });

        it('should keep maxTokensForOutput if not provided', () => {
            const tracker = new ContextTracker(100000, 8192);
            tracker.updateContextWindow(200000);
            expect(tracker.getContextUsage().reservedForOutput).toBe(8192);
        });
    });

    describe('calculateTokenDistribution', () => {
        it('should return percentages summing to ~100', () => {
            const tracker = new ContextTracker(100000, 10000);
            tracker.updateUsage(40000, 10000);
            const dist = tracker.calculateTokenDistribution();
            const total = dist.currentPercent + dist.reservedPercent + dist.availablePercent;
            expect(Math.round(total)).toBe(100);
        });

        it('should handle context window of 0 gracefully', () => {
            const tracker = new ContextTracker(0);
            const dist = tracker.calculateTokenDistribution();
            // With contextWindow=0 and default maxTokensForOutput=8192,
            // total = 0 + 8192 + 0 = 8192, reservedPercent = 100%
            const total = dist.currentPercent + dist.reservedPercent + dist.availablePercent;
            expect(Math.round(total)).toBe(100);
        });
    });

    describe('getContextColor', () => {
        it('should return green for low usage', () => {
            const tracker = new ContextTracker(100000);
            tracker.updateUsage(30000, 0);
            expect(tracker.getContextColor()).toBe('green');
        });

        it('should return yellow for moderate usage (61-85%)', () => {
            const tracker = new ContextTracker(100000);
            tracker.updateUsage(70000, 0);
            expect(tracker.getContextColor()).toBe('yellow');
        });

        it('should return red for high usage (86%+)', () => {
            const tracker = new ContextTracker(100000);
            tracker.updateUsage(90000, 0);
            expect(tracker.getContextColor()).toBe('red');
        });

        it('should return yellow at exactly 61%', () => {
            const tracker = new ContextTracker(100);
            tracker.updateUsage(61, 0);
            expect(tracker.getContextColor()).toBe('yellow');
        });

        it('should return red at exactly 86%', () => {
            const tracker = new ContextTracker(100);
            tracker.updateUsage(86, 0);
            expect(tracker.getContextColor()).toBe('red');
        });
    });

    describe('reset', () => {
        it('should reset tokens used to 0', () => {
            const tracker = new ContextTracker(100000);
            tracker.updateUsage(50000, 10000);
            tracker.reset();
            expect(tracker.getContextUsage().tokensUsed).toBe(0);
        });
    });
});
