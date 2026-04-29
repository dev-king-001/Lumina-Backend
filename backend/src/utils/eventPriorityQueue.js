'use strict';

/**
 * EventPriorityQueue - A Min-Heap based priority queue for handling time-sensitive events.
 * Optimized for O(log n) insertion and extraction.
 * 
 * This utility is designed for high-precision handling of vesting unlocks and other
 * time-critical off-chain synchronization tasks.
 */
class EventPriorityQueue {
  constructor() {
    this.heap = [];
  }

  /**
   * Enqueue an event with a priority (timestamp).
   * @param {any} data - The event data.
   * @param {number|Date} priority - The timestamp/priority of the event.
   */
  enqueue(data, priority) {
    if (priority === undefined || priority === null) {
      throw new Error('Priority (timestamp) is required for EventPriorityQueue');
    }
    const timestamp = priority instanceof Date ? priority.getTime() : Number(priority);
    
    if (isNaN(timestamp)) {
      throw new Error('Invalid priority: must be a valid number or Date object');
    }

    const node = { data, priority: timestamp };
    this.heap.push(node);
    this._bubbleUp();
  }

  /**
   * Dequeue the event with the smallest priority (earliest timestamp).
   * @returns {any|null} The event data or null if empty.
   */
  dequeue() {
    if (this.isEmpty()) return null;
    const min = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this._bubbleDown();
    }
    return min.data;
  }

  /**
   * Peek at the earliest event without removing it.
   * @returns {any|null} The event data or null if empty.
   */
  peek() {
    return this.isEmpty() ? null : this.heap[0].data;
  }

  /**
   * Peek at the earliest priority.
   * @returns {number|null} The earliest timestamp or null if empty.
   */
  peekPriority() {
    return this.isEmpty() ? null : this.heap[0].priority;
  }

  /**
   * Get all events that are due (priority <= currentTime).
   * @param {number|Date} [currentTime=Date.now()] - The current time threshold.
   * @returns {Array<any>} Array of due event data.
   */
  getDueEvents(currentTime = Date.now()) {
    const now = currentTime instanceof Date ? currentTime.getTime() : Number(currentTime);
    const dueEvents = [];
    
    while (!this.isEmpty() && this.peekPriority() <= now) {
      dueEvents.push(this.dequeue());
    }
    
    return dueEvents;
  }

  /**
   * Check if the queue is empty.
   * @returns {boolean}
   */
  isEmpty() {
    return this.heap.length === 0;
  }

  /**
   * Get the number of events in the queue.
   * @returns {number}
   */
  size() {
    return this.heap.length;
  }

  /**
   * Clear all events from the queue.
   */
  clear() {
    this.heap = [];
  }

  /**
   * @private
   */
  _bubbleUp() {
    let index = this.heap.length - 1;
    while (index > 0) {
      let parentIndex = Math.floor((index - 1) / 2);
      if (this.heap[index].priority >= this.heap[parentIndex].priority) break;
      [this.heap[index], this.heap[parentIndex]] = [this.heap[parentIndex], this.heap[index]];
      index = parentIndex;
    }
  }

  /**
   * @private
   */
  _bubbleDown() {
    let index = 0;
    const length = this.heap.length;
    while (true) {
      let leftChildIndex = 2 * index + 1;
      let rightChildIndex = 2 * index + 2;
      let swap = null;

      if (leftChildIndex < length) {
        if (this.heap[leftChildIndex].priority < this.heap[index].priority) {
          swap = leftChildIndex;
        }
      }

      if (rightChildIndex < length) {
        if (
          (swap === null && this.heap[rightChildIndex].priority < this.heap[index].priority) ||
          (swap !== null && this.heap[rightChildIndex].priority < this.heap[leftChildIndex].priority)
        ) {
          swap = rightChildIndex;
        }
      }

      if (swap === null) break;
      [this.heap[index], this.heap[swap]] = [this.heap[swap], this.heap[index]];
      index = swap;
    }
  }
}

module.exports = EventPriorityQueue;
