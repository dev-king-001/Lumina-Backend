export interface BackendWeightState {
  backendId: string;
  healthScore: number; // 0 - 100
  currentWeight: number; // 0 - 100
  isDraining: boolean;
  drainStartedAt?: number; // timestamp in ms
}

const MAX_WEIGHT = 100;
const MIN_WEIGHT_BEFORE_DRAIN = 5;
const DRAIN_TIMEOUT_MS = 30000; // 30s

export class WeightCalculator {
  private states = new Map<string, BackendWeightState>();

  calculateWeight(backendId: string, healthScore: number): BackendWeightState {
    let state = this.states.get(backendId);
    const now = Date.now();

    if (!state) {
      state = {
        backendId,
        healthScore,
        currentWeight: MAX_WEIGHT,
        isDraining: false,
      };
    }

    state.healthScore = healthScore;

    // Check if health score drops below 60 (of 100)
    if (healthScore < 60) {
      if (!state.isDraining) {
        // Immediately halve the weight and begin 30s drain timer
        state.isDraining = true;
        state.drainStartedAt = now;
        state.currentWeight = Math.max(MIN_WEIGHT_BEFORE_DRAIN, Math.round(state.currentWeight * 0.5));
      } else {
        // If already draining, check if 30s has passed
        const elapsed = now - (state.drainStartedAt || now);
        if (elapsed >= DRAIN_TIMEOUT_MS) {
          state.currentWeight = 0;
        } else {
          // Weight decay factor: 50% per degradation level
          const degradationLevels = Math.floor((60 - healthScore) / 10);
          let targetWeight = MAX_WEIGHT * Math.pow(0.5, degradationLevels + 1);
          state.currentWeight = Math.max(MIN_WEIGHT_BEFORE_DRAIN, Math.round(targetWeight));
        }
      }
    } else {
      // Normal weight calculation: linear scale from 60 to 100
      state.isDraining = false;
      state.drainStartedAt = undefined;
      state.currentWeight = Math.round(healthScore);
    }

    this.states.set(backendId, state);
    return state;
  }

  getWeightState(backendId: string): BackendWeightState | undefined {
    return this.states.get(backendId);
  }
}
